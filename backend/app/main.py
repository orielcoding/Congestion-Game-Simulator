"""
Congestion Game Simulator - FastAPI Backend
Implements Wardrop Equilibrium and System Optimum solvers using Frank-Wolfe algorithm
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Optional, Tuple
import numpy as np
from scipy.optimize import minimize_scalar
import networkx as nx

app = FastAPI(title="Congestion Game Simulator", version="1.0.0")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─────────────────────────────────────────────────────────────────────────────
# Data Models
# ─────────────────────────────────────────────────────────────────────────────

class EdgeCostFunction(BaseModel):
    """Cost function parameters for an edge: t(f) = a * f^k + b"""
    a: float = 1.0
    k: float = 1.0
    b: float = 0.0
    function_type: str = "polynomial"  # "polynomial" or "bpr"
    # BPR specific: t(f) = free_flow_time * (1 + alpha * (f/capacity)^beta)
    free_flow_time: float = 1.0
    capacity: float = 1.0
    alpha: float = 0.15
    beta: float = 4.0

class Edge(BaseModel):
    id: str
    source: str
    target: str
    cost_function: EdgeCostFunction

class Node(BaseModel):
    id: str
    x: float
    y: float

class ODPair(BaseModel):
    origin: str
    destination: str
    demand: float

class NetworkData(BaseModel):
    nodes: List[Node]
    edges: List[Edge]
    od_pairs: List[ODPair]

class PathFlow(BaseModel):
    path: List[str]  # List of node IDs
    edges: List[str]  # List of edge IDs
    flow: float

class EdgeResult(BaseModel):
    id: str
    flow: float
    cost: float
    toll: float = 0.0
    congestion_level: float  # 0-1, for visualization

class EquilibriumResult(BaseModel):
    edge_results: List[EdgeResult]
    path_flows: List[PathFlow]
    total_system_cost: float
    od_costs: Dict[str, float]  # Cost for each OD pair

class ComputationResult(BaseModel):
    wardrop_equilibrium: EquilibriumResult
    system_optimum: EquilibriumResult
    price_of_anarchy: float
    optimal_tolls: Dict[str, float]

# ─────────────────────────────────────────────────────────────────────────────
# Cost Function Evaluation
# ─────────────────────────────────────────────────────────────────────────────

def evaluate_cost(cost_func: EdgeCostFunction, flow: float) -> float:
    """Evaluate the cost function at a given flow"""
    if cost_func.function_type == "bpr":
        ratio = flow / cost_func.capacity if cost_func.capacity > 0 else 0
        return cost_func.free_flow_time * (1 + cost_func.alpha * (ratio ** cost_func.beta))
    else:  # polynomial: a * f^k + b
        return cost_func.a * (flow ** cost_func.k) + cost_func.b

def evaluate_cost_derivative(cost_func: EdgeCostFunction, flow: float) -> float:
    """Evaluate the derivative of cost function"""
    if cost_func.function_type == "bpr":
        if cost_func.capacity <= 0:
            return 0
        ratio = flow / cost_func.capacity
        return cost_func.free_flow_time * cost_func.alpha * cost_func.beta * \
               (ratio ** (cost_func.beta - 1)) / cost_func.capacity
    else:  # polynomial: a * k * f^(k-1)
        if cost_func.k == 0 or flow == 0:
            return 0
        return cost_func.a * cost_func.k * (flow ** (cost_func.k - 1))

def evaluate_marginal_cost(cost_func: EdgeCostFunction, flow: float) -> float:
    """Evaluate marginal cost: t(f) + f * t'(f)"""
    return evaluate_cost(cost_func, flow) + flow * evaluate_cost_derivative(cost_func, flow)

def evaluate_integral(cost_func: EdgeCostFunction, flow: float) -> float:
    """Evaluate integral of cost function from 0 to flow (for Beckmann objective)"""
    if cost_func.function_type == "bpr":
        # ∫t(s)ds from 0 to f where t(s) = T*(1 + α*(s/C)^β)
        T = cost_func.free_flow_time
        C = cost_func.capacity
        alpha = cost_func.alpha
        beta = cost_func.beta
        if C <= 0:
            return T * flow
        return T * flow + T * alpha * (flow ** (beta + 1)) / ((beta + 1) * (C ** beta))
    else:  # polynomial: ∫(a*s^k + b)ds = a*f^(k+1)/(k+1) + b*f
        a, k, b = cost_func.a, cost_func.k, cost_func.b
        return a * (flow ** (k + 1)) / (k + 1) + b * flow

# ─────────────────────────────────────────────────────────────────────────────
# Path Finding
# ─────────────────────────────────────────────────────────────────────────────

def find_all_simple_paths(graph: nx.DiGraph, source: str, target: str, 
                          max_paths: int = 50) -> List[List[str]]:
    """Find all simple paths between source and target (limited for performance)"""
    try:
        paths = list(nx.all_simple_paths(graph, source, target, cutoff=10))
        return paths[:max_paths]  # Limit number of paths for computational feasibility
    except nx.NetworkXNoPath:
        return []

def path_to_edges(path: List[str], edge_map: Dict[Tuple[str, str], str]) -> List[str]:
    """Convert a path of nodes to a list of edge IDs"""
    edges = []
    for i in range(len(path) - 1):
        edge_key = (path[i], path[i+1])
        if edge_key in edge_map:
            edges.append(edge_map[edge_key])
    return edges

# ─────────────────────────────────────────────────────────────────────────────
# Frank-Wolfe Algorithm for Traffic Assignment
# ─────────────────────────────────────────────────────────────────────────────

class TrafficAssignment:
    """Traffic assignment solver using Frank-Wolfe algorithm"""
    
    def __init__(self, network: NetworkData):
        self.network = network
        self.graph = nx.DiGraph()
        self.edge_map: Dict[Tuple[str, str], str] = {}  # (source, target) -> edge_id
        self.edge_data: Dict[str, Edge] = {}  # edge_id -> Edge
        self.paths_by_od: Dict[Tuple[str, str], List[List[str]]] = {}
        self.path_edge_matrix: Optional[np.ndarray] = None
        self.all_paths: List[Tuple[Tuple[str, str], List[str], List[str]]] = []  # (od, path, edges)
        
        self._build_graph()
        self._find_paths()
    
    def _build_graph(self):
        """Build NetworkX graph from network data"""
        for node in self.network.nodes:
            self.graph.add_node(node.id)
        
        for edge in self.network.edges:
            self.graph.add_edge(edge.source, edge.target, id=edge.id)
            self.edge_map[(edge.source, edge.target)] = edge.id
            self.edge_data[edge.id] = edge
    
    def _find_paths(self):
        """Find all paths for each OD pair"""
        for od in self.network.od_pairs:
            paths = find_all_simple_paths(self.graph, od.origin, od.destination)
            if not paths:
                continue
            
            self.paths_by_od[(od.origin, od.destination)] = paths
            
            for path in paths:
                edges = path_to_edges(path, self.edge_map)
                self.all_paths.append(((od.origin, od.destination), path, edges))
    
    def _compute_edge_flows(self, path_flows: np.ndarray) -> Dict[str, float]:
        """Compute edge flows from path flows"""
        edge_flows = {edge.id: 0.0 for edge in self.network.edges}
        
        for i, (od, path, edges) in enumerate(self.all_paths):
            for edge_id in edges:
                edge_flows[edge_id] += path_flows[i]
        
        return edge_flows
    
    def _compute_path_costs(self, edge_flows: Dict[str, float], use_marginal: bool = False) -> np.ndarray:
        """Compute cost of each path based on edge flows"""
        path_costs = np.zeros(len(self.all_paths))
        
        for i, (od, path, edges) in enumerate(self.all_paths):
            cost = 0.0
            for edge_id in edges:
                edge = self.edge_data[edge_id]
                flow = edge_flows[edge_id]
                if use_marginal:
                    cost += evaluate_marginal_cost(edge.cost_function, flow)
                else:
                    cost += evaluate_cost(edge.cost_function, flow)
            path_costs[i] = cost
        
        return path_costs
    
    def _all_or_nothing(self, path_costs: np.ndarray) -> np.ndarray:
        """All-or-nothing assignment: assign all demand to shortest path for each OD"""
        path_flows = np.zeros(len(self.all_paths))
        
        for od in self.network.od_pairs:
            od_key = (od.origin, od.destination)
            if od_key not in self.paths_by_od:
                continue
            
            # Find path indices for this OD
            od_path_indices = []
            for i, (path_od, path, edges) in enumerate(self.all_paths):
                if path_od == od_key:
                    od_path_indices.append(i)
            
            if not od_path_indices:
                continue
            
            # Find minimum cost path
            od_costs = path_costs[od_path_indices]
            min_idx = od_path_indices[np.argmin(od_costs)]
            path_flows[min_idx] = od.demand
        
        return path_flows
    
    def _beckmann_objective(self, edge_flows: Dict[str, float]) -> float:
        """Compute Beckmann objective: sum of integrals of cost functions"""
        total = 0.0
        for edge_id, flow in edge_flows.items():
            edge = self.edge_data[edge_id]
            total += evaluate_integral(edge.cost_function, flow)
        return total
    
    def _system_cost_objective(self, edge_flows: Dict[str, float]) -> float:
        """Compute total system cost: sum of f_e * t_e(f_e)"""
        total = 0.0
        for edge_id, flow in edge_flows.items():
            edge = self.edge_data[edge_id]
            total += flow * evaluate_cost(edge.cost_function, flow)
        return total
    
    def _line_search(self, current_flows: np.ndarray, direction_flows: np.ndarray, 
                     objective_type: str = "beckmann") -> float:
        """Find optimal step size using line search"""
        def objective(alpha):
            new_flows = current_flows + alpha * (direction_flows - current_flows)
            edge_flows = self._compute_edge_flows(new_flows)
            if objective_type == "beckmann":
                return self._beckmann_objective(edge_flows)
            else:
                return self._system_cost_objective(edge_flows)
        
        result = minimize_scalar(objective, bounds=(0, 1), method='bounded')
        return result.x
    
    def solve_wardrop_equilibrium(self, max_iter: int = 1000, tolerance: float = 1e-6) -> Tuple[np.ndarray, Dict[str, float]]:
        """
        Solve for Wardrop (User) Equilibrium using Frank-Wolfe algorithm.
        Minimizes Beckmann objective: sum of integrals of cost functions
        """
        if not self.all_paths:
            return np.array([]), {}
        
        # Initialize with all-or-nothing assignment
        edge_flows = {edge.id: 0.0 for edge in self.network.edges}
        path_costs = self._compute_path_costs(edge_flows)
        path_flows = self._all_or_nothing(path_costs)
        
        for iteration in range(max_iter):
            # Compute current edge flows
            edge_flows = self._compute_edge_flows(path_flows)
            
            # Compute path costs based on current flows
            path_costs = self._compute_path_costs(edge_flows, use_marginal=False)
            
            # All-or-nothing assignment for search direction
            direction_flows = self._all_or_nothing(path_costs)
            
            # Line search
            alpha = self._line_search(path_flows, direction_flows, "beckmann")
            
            # Update flows
            new_path_flows = path_flows + alpha * (direction_flows - path_flows)
            
            # Check convergence
            if np.max(np.abs(new_path_flows - path_flows)) < tolerance:
                path_flows = new_path_flows
                break
            
            path_flows = new_path_flows
        
        return path_flows, self._compute_edge_flows(path_flows)
    
    def solve_system_optimum(self, max_iter: int = 1000, tolerance: float = 1e-6) -> Tuple[np.ndarray, Dict[str, float]]:
        """
        Solve for System Optimum using Frank-Wolfe algorithm.
        Minimizes total system cost: sum of f_e * t_e(f_e)
        Uses marginal costs in path finding.
        """
        if not self.all_paths:
            return np.array([]), {}
        
        # Initialize with all-or-nothing assignment using marginal costs
        edge_flows = {edge.id: 0.0 for edge in self.network.edges}
        path_costs = self._compute_path_costs(edge_flows, use_marginal=True)
        path_flows = self._all_or_nothing(path_costs)
        
        for iteration in range(max_iter):
            # Compute current edge flows
            edge_flows = self._compute_edge_flows(path_flows)
            
            # Compute path costs using marginal costs
            path_costs = self._compute_path_costs(edge_flows, use_marginal=True)
            
            # All-or-nothing assignment for search direction
            direction_flows = self._all_or_nothing(path_costs)
            
            # Line search for system cost objective
            alpha = self._line_search(path_flows, direction_flows, "system")
            
            # Update flows
            new_path_flows = path_flows + alpha * (direction_flows - path_flows)
            
            # Check convergence
            if np.max(np.abs(new_path_flows - path_flows)) < tolerance:
                path_flows = new_path_flows
                break
            
            path_flows = new_path_flows
        
        return path_flows, self._compute_edge_flows(path_flows)
    
    def compute_optimal_tolls(self, so_edge_flows: Dict[str, float]) -> Dict[str, float]:
        """Compute optimal tolls using marginal cost pricing: τ_e = f_e * t'_e(f_e)"""
        tolls = {}
        for edge_id, flow in so_edge_flows.items():
            edge = self.edge_data[edge_id]
            tolls[edge_id] = flow * evaluate_cost_derivative(edge.cost_function, flow)
        return tolls
    
    def format_results(self, path_flows: np.ndarray, edge_flows: Dict[str, float], 
                       tolls: Optional[Dict[str, float]] = None) -> EquilibriumResult:
        """Format results into response model"""
        # Determine max flow for congestion level normalization
        max_flow = max(edge_flows.values()) if edge_flows and max(edge_flows.values()) > 0 else 1.0
        
        edge_results = []
        for edge_id, flow in edge_flows.items():
            edge = self.edge_data[edge_id]
            cost = evaluate_cost(edge.cost_function, flow)
            toll = tolls.get(edge_id, 0.0) if tolls else 0.0
            congestion = min(flow / max_flow, 1.0) if max_flow > 0 else 0.0
            
            edge_results.append(EdgeResult(
                id=edge_id,
                flow=round(flow, 4),
                cost=round(cost, 4),
                toll=round(toll, 4),
                congestion_level=round(congestion, 4)
            ))
        
        # Format path flows
        path_flow_results = []
        for i, (od, path, edges) in enumerate(self.all_paths):
            if path_flows[i] > 1e-6:  # Only include paths with non-zero flow
                path_flow_results.append(PathFlow(
                    path=path,
                    edges=edges,
                    flow=round(path_flows[i], 4)
                ))
        
        # Compute total system cost
        total_cost = sum(
            edge_flows[edge_id] * evaluate_cost(self.edge_data[edge_id].cost_function, edge_flows[edge_id])
            for edge_id in edge_flows
        )
        
        # Compute OD costs (minimum path cost for each OD)
        od_costs = {}
        path_costs = self._compute_path_costs(edge_flows)
        for od in self.network.od_pairs:
            od_key = (od.origin, od.destination)
            od_path_indices = [i for i, (p_od, _, _) in enumerate(self.all_paths) if p_od == od_key]
            if od_path_indices:
                # Weighted average cost
                total_flow = sum(path_flows[i] for i in od_path_indices)
                if total_flow > 0:
                    avg_cost = sum(path_flows[i] * path_costs[i] for i in od_path_indices) / total_flow
                else:
                    avg_cost = min(path_costs[i] for i in od_path_indices)
                od_costs[f"{od.origin}->{od.destination}"] = round(avg_cost, 4)
        
        return EquilibriumResult(
            edge_results=edge_results,
            path_flows=path_flow_results,
            total_system_cost=round(total_cost, 4),
            od_costs=od_costs
        )

# ─────────────────────────────────────────────────────────────────────────────
# API Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/")
def root():
    return {"message": "Congestion Game Simulator API", "version": "1.0.0"}

@app.post("/compute", response_model=ComputationResult)
def compute_equilibrium(network: NetworkData):
    """
    Compute both Wardrop Equilibrium and System Optimum for the given network.
    Returns flow distributions, costs, and optimal tolls.
    """
    try:
        # Validate input
        if not network.nodes:
            raise HTTPException(status_code=400, detail="No nodes provided")
        if not network.edges:
            raise HTTPException(status_code=400, detail="No edges provided")
        if not network.od_pairs:
            raise HTTPException(status_code=400, detail="No OD pairs provided")
        
        # Check for valid OD pairs
        node_ids = {node.id for node in network.nodes}
        for od in network.od_pairs:
            if od.origin not in node_ids:
                raise HTTPException(status_code=400, detail=f"Origin node {od.origin} not found")
            if od.destination not in node_ids:
                raise HTTPException(status_code=400, detail=f"Destination node {od.destination} not found")
        
        # Create solver
        solver = TrafficAssignment(network)
        
        # Solve for Wardrop Equilibrium
        we_path_flows, we_edge_flows = solver.solve_wardrop_equilibrium()
        we_result = solver.format_results(we_path_flows, we_edge_flows)
        
        # Solve for System Optimum
        so_path_flows, so_edge_flows = solver.solve_system_optimum()
        optimal_tolls = solver.compute_optimal_tolls(so_edge_flows)
        so_result = solver.format_results(so_path_flows, so_edge_flows, optimal_tolls)
        
        # Calculate Price of Anarchy
        poa = we_result.total_system_cost / so_result.total_system_cost if so_result.total_system_cost > 0 else 1.0
        
        return ComputationResult(
            wardrop_equilibrium=we_result,
            system_optimum=so_result,
            price_of_anarchy=round(poa, 4),
            optimal_tolls={k: round(v, 4) for k, v in optimal_tolls.items()}
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Computation error: {str(e)}")

@app.post("/validate")
def validate_network(network: NetworkData):
    """Validate network structure and check for connectivity"""
    try:
        graph = nx.DiGraph()
        for node in network.nodes:
            graph.add_node(node.id)
        for edge in network.edges:
            graph.add_edge(edge.source, edge.target)
        
        issues = []
        
        # Check for connectivity between OD pairs
        for od in network.od_pairs:
            if not nx.has_path(graph, od.origin, od.destination):
                issues.append(f"No path from {od.origin} to {od.destination}")
        
        # Check for isolated nodes
        for node in network.nodes:
            if graph.degree(node.id) == 0:
                issues.append(f"Node {node.id} is isolated")
        
        return {
            "valid": len(issues) == 0,
            "issues": issues,
            "node_count": len(network.nodes),
            "edge_count": len(network.edges),
            "od_pair_count": len(network.od_pairs)
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Validation error: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
