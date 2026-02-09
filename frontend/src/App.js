import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import axios from 'axios';
import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

// API Configuration
const API_BASE_URL =  'https://congestion-game-simulator.onrender.com/';

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

const generateId = () => Math.random().toString(36).substr(2, 9);

const getCongestionColor = (level) => {
  // Green to Yellow to Red based on congestion level (0-1)
  const r = Math.min(255, Math.floor(level * 2 * 255));
  const g = Math.min(255, Math.floor((1 - level) * 2 * 255));
  return `rgb(${r}, ${g}, 50)`;
};

const formatNumber = (value, decimals = 2) => {
  if (value === null || value === undefined || Number.isNaN(value)) return '0';
  const rounded = Number.parseFloat(value).toFixed(decimals);
  return String(Number(rounded));
};

const formatCostFunctionLabel = (costFunction) => {
  if (!costFunction) return 't=0';
  if (costFunction.function_type === 'bpr') {
    return `t=${formatNumber(costFunction.free_flow_time)}(1+${formatNumber(costFunction.alpha)}(f/${formatNumber(costFunction.capacity)})^${formatNumber(costFunction.beta)})`;
  }

  return `t=${formatNumber(costFunction.a)}f^${formatNumber(costFunction.k)}+${formatNumber(costFunction.b)}`;
};

const getConnectivityRatio = (nodeCount, edgeCount) => {
  if (nodeCount < 2) return 0;
  return edgeCount / (nodeCount * (nodeCount - 1));
};

const formatNetworkName = (nodeCount, edgeCount) => {
  const ratio = getConnectivityRatio(nodeCount, edgeCount);
  return `${nodeCount}N-${edgeCount}E CR ${ratio.toFixed(2)}`;
};

const downloadJson = (filename, payload) => {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

// ─────────────────────────────────────────────────────────────────────────────
// Prebuilt Network Examples
// ─────────────────────────────────────────────────────────────────────────────

const BRAESS_PARADOX_NETWORK = {
  nodes: [
    { id: '1', x: 100, y: 200 },
    { id: '2', x: 300, y: 100 },
    { id: '3', x: 300, y: 300 },
    { id: '4', x: 500, y: 200 },
  ],
  edges: [
    { id: 'e1', source: '1', target: '2', cost_function: { a: 1, k: 1, b: 0, function_type: 'polynomial' } },
    { id: 'e2', source: '1', target: '3', cost_function: { a: 0, k: 0, b: 45, function_type: 'polynomial' } },
    { id: 'e3', source: '2', target: '4', cost_function: { a: 0, k: 0, b: 45, function_type: 'polynomial' } },
    { id: 'e4', source: '3', target: '4', cost_function: { a: 1, k: 1, b: 0, function_type: 'polynomial' } },
    { id: 'e5', source: '2', target: '3', cost_function: { a: 0, k: 0, b: 0, function_type: 'polynomial' } },
  ],
  od_pairs: [{ origin: '1', destination: '4', demand: 60 }],
};

const SIMPLE_TWO_PATH = {
  nodes: [
    { id: '1', x: 100, y: 200 },
    { id: '2', x: 400, y: 200 },
  ],
  edges: [
    { id: 'e1', source: '1', target: '2', cost_function: { a: 1, k: 1, b: 10, function_type: 'polynomial' } },
  ],
  od_pairs: [{ origin: '1', destination: '2', demand: 10 }],
};

const PIGOU_NETWORK = {
  nodes: [
    { id: '1', x: 100, y: 200 },
    { id: '2', x: 300, y: 100 },
    { id: '3', x: 300, y: 300 },
    { id: '4', x: 500, y: 200 },
  ],
  edges: [
    { id: 'e1', source: '1', target: '2', cost_function: { a: 1, k: 1, b: 0, function_type: 'polynomial' } },
    { id: 'e2', source: '1', target: '3', cost_function: { a: 0, k: 0, b: 1, function_type: 'polynomial' } },
    { id: 'e3', source: '2', target: '4', cost_function: { a: 0, k: 0, b: 0, function_type: 'polynomial' } },
    { id: 'e4', source: '3', target: '4', cost_function: { a: 0, k: 0, b: 0, function_type: 'polynomial' } },
  ],
  od_pairs: [{ origin: '1', destination: '4', demand: 1 }],
};

// ─────────────────────────────────────────────────────────────────────────────
// SVG Graph Component
// ─────────────────────────────────────────────────────────────────────────────

const NetworkCanvas = ({ 
  nodes, 
  edges, 
  mode, 
  selectedEdge, 
  onAddNode, 
  onNodeClick, 
  onEdgeClick,
  edgeResults,
  showResults
}) => {
  const svgRef = useRef(null);
  const [sourceNode, setSourceNode] = useState(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  const handleCanvasClick = (e) => {
    if (mode !== 'addNode') return;
    
    const svg = svgRef.current;
    const rect = svg.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    onAddNode(x, y);
  };

  const handleNodeClick = (e, node) => {
    e.stopPropagation();
    
    if (mode === 'addEdge') {
      if (!sourceNode) {
        setSourceNode(node);
      } else if (sourceNode.id !== node.id) {
        onNodeClick(sourceNode, node);
        setSourceNode(null);
      }
    }
  };

  const handleMouseMove = (e) => {
    if (mode === 'addEdge' && sourceNode) {
      const svg = svgRef.current;
      const rect = svg.getBoundingClientRect();
      setMousePos({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      });
    }
  };

  const getEdgeResult = (edgeId) => {
    if (!edgeResults || !showResults) return null;
    return edgeResults.find(r => r.id === edgeId);
  };

  const getEdgeColor = (edge) => {
    const result = getEdgeResult(edge.id);
    if (result) {
      return getCongestionColor(result.congestion_level);
    }
    return edge.id === selectedEdge ? '#6366f1' : '#4a4a6a';
  };

  const getEdgeWidth = (edge) => {
    const result = getEdgeResult(edge.id);
    if (result && result.flow > 0) {
      return Math.max(2, Math.min(8, 2 + result.flow / 10));
    }
    return edge.id === selectedEdge ? 3 : 2;
  };

  // Calculate arrow path for directed edge
  const getArrowPath = (source, target) => {
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    
    if (len === 0) return { path: '', midX: source.x, midY: source.y };
    
    // Offset to not overlap with node circles
    const nodeRadius = 24;
    const arrowSize = 10;
    
    const startX = source.x + (dx / len) * nodeRadius;
    const startY = source.y + (dy / len) * nodeRadius;
    const endX = target.x - (dx / len) * (nodeRadius + arrowSize);
    const endY = target.y - (dy / len) * (nodeRadius + arrowSize);
    
    // Arrow head
    const angle = Math.atan2(dy, dx);
    const arrowAngle = Math.PI / 6;
    const ax1 = endX + arrowSize * Math.cos(angle - Math.PI + arrowAngle);
    const ay1 = endY + arrowSize * Math.sin(angle - Math.PI + arrowAngle);
    const ax2 = endX + arrowSize * Math.cos(angle - Math.PI - arrowAngle);
    const ay2 = endY + arrowSize * Math.sin(angle - Math.PI - arrowAngle);
    
    const tipX = target.x - (dx / len) * nodeRadius;
    const tipY = target.y - (dy / len) * nodeRadius;
    
    return {
      linePath: `M ${startX} ${startY} L ${endX} ${endY}`,
      arrowPath: `M ${tipX} ${tipY} L ${ax1} ${ay1} L ${ax2} ${ay2} Z`,
      midX: (startX + endX) / 2,
      midY: (startY + endY) / 2,
    };
  };

  const getEdgeLabelLines = (edge, result) => {
    const formulaLine = formatCostFunctionLabel(edge.cost_function);
    if (!result) return [formulaLine];
    return [formulaLine, `f=${formatNumber(result.flow)} c=${formatNumber(result.cost)}`];
  };

  return (
    <svg
      ref={svgRef}
      className="cytoscape-container"
      onClick={handleCanvasClick}
      onMouseMove={handleMouseMove}
      style={{ cursor: mode === 'addNode' ? 'crosshair' : 'default' }}
    >
      {/* Grid pattern background */}
      <defs>
        <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1a1a2e" strokeWidth="1"/>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#grid)" />

      {/* Edges */}
      {edges.map(edge => {
        const source = nodes.find(n => n.id === edge.source);
        const target = nodes.find(n => n.id === edge.target);
        if (!source || !target) return null;
        
        const { linePath, arrowPath, midX, midY } = getArrowPath(source, target);
        const result = getEdgeResult(edge.id);
        const labelLines = getEdgeLabelLines(edge, result);
        const labelWidth = Math.max(80, Math.max(...labelLines.map(line => line.length)) * 6);
        const labelHeight = 18 + (labelLines.length - 1) * 12;
        
        return (
          <g key={edge.id} onClick={(e) => { e.stopPropagation(); onEdgeClick(edge); }}>
            {/* Edge line */}
            <path
              d={linePath}
              stroke={getEdgeColor(edge)}
              strokeWidth={getEdgeWidth(edge)}
              fill="none"
              style={{ cursor: 'pointer', transition: 'stroke 0.3s, stroke-width 0.3s' }}
            />
            {/* Arrow head */}
            <path
              d={arrowPath}
              fill={getEdgeColor(edge)}
              style={{ transition: 'fill 0.3s' }}
            />
            {/* Edge label */}
            <g transform={`translate(${midX}, ${midY})`}>
              <rect
                x={-labelWidth / 2}
                y={-labelHeight / 2}
                width={labelWidth}
                height={labelHeight}
                fill="rgba(10, 10, 20, 0.9)"
                rx="4"
              />
              <text
                textAnchor="middle"
                dy={labelLines.length > 1 ? -2 : 4}
                fill="#e0e0e0"
                fontSize="10"
                fontFamily="Inter, sans-serif"
              >
                {labelLines.map((line, idx) => (
                  <tspan key={idx} x="0" dy={idx === 0 ? 0 : 12}>{line}</tspan>
                ))}
              </text>
            </g>
          </g>
        );
      })}

      {/* Temporary edge while creating */}
      {sourceNode && mode === 'addEdge' && (
        <line
          x1={sourceNode.x}
          y1={sourceNode.y}
          x2={mousePos.x}
          y2={mousePos.y}
          stroke="#6366f1"
          strokeWidth="2"
          strokeDasharray="5,5"
        />
      )}

      {/* Nodes */}
      {nodes.map(node => (
        <g
          key={node.id}
          transform={`translate(${node.x}, ${node.y})`}
          onClick={(e) => handleNodeClick(e, node)}
          style={{ cursor: mode === 'addEdge' ? 'pointer' : 'default' }}
        >
          <circle
            r="24"
            fill={sourceNode?.id === node.id ? '#6366f1' : '#1a1a2e'}
            stroke={sourceNode?.id === node.id ? '#818cf8' : '#4a4a6a'}
            strokeWidth="2"
          />
          <text
            textAnchor="middle"
            dy="5"
            fill="white"
            fontSize="14"
            fontWeight="600"
            fontFamily="Inter, sans-serif"
          >
            {node.id}
          </text>
        </g>
      ))}

      {/* Mode instructions */}
      <text x="20" y="30" fill="#666" fontSize="12" fontFamily="Inter, sans-serif">
        {mode === 'addNode' && 'Click to add a node'}
        {mode === 'addEdge' && (sourceNode ? `Click target node (from ${sourceNode.id})` : 'Click source node')}
        {mode === 'select' && 'Click an edge to configure'}
      </text>
    </svg>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Main App Component
// ─────────────────────────────────────────────────────────────────────────────

function App() {
  // Network state
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [odPairs, setOdPairs] = useState([]);
  const [nextNodeId, setNextNodeId] = useState(1);

  const [savedNetworks, setSavedNetworks] = useState([]);
  const [simulationHistory, setSimulationHistory] = useState([]);
  const [demandEditorId, setDemandEditorId] = useState(null);
  const importInputRef = useRef(null);

  // UI state
  const [mode, setMode] = useState('addNode'); // 'addNode', 'addEdge', 'select'
  const [selectedEdge, setSelectedEdge] = useState(null);
  const [selectedEdgeData, setSelectedEdgeData] = useState(null);
  
  // Results state
  const [results, setResults] = useState(null);
  const [resultType, setResultType] = useState('we'); // 'we' or 'so'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // ─────────────────────────────────────────────────────────────────────────
  // Node/Edge Handlers
  // ─────────────────────────────────────────────────────────────────────────

  const handleAddNode = useCallback((x, y) => {
    const newNode = {
      id: String(nextNodeId),
      x,
      y
    };
    setNodes(prev => [...prev, newNode]);
    setNextNodeId(prev => prev + 1);
  }, [nextNodeId]);

  const handleCreateEdge = useCallback((source, target) => {
    // Check if edge already exists
    const exists = edges.some(e => e.source === source.id && e.target === target.id);
    if (exists) return;

    const newEdge = {
      id: `e${generateId()}`,
      source: source.id,
      target: target.id,
      cost_function: {
        a: 1,
        k: 1,
        b: 0,
        function_type: 'polynomial',
        free_flow_time: 1,
        capacity: 100,
        alpha: 0.15,
        beta: 4
      }
    };
    setEdges(prev => [...prev, newEdge]);
  }, [edges]);

  const handleEdgeClick = useCallback((edge) => {
    setSelectedEdge(edge.id);
    setSelectedEdgeData({ ...edge });
    setMode('select');
  }, []);

  const updateEdgeCostFunction = (field, value) => {
    if (!selectedEdgeData) return;
    
    const updated = {
      ...selectedEdgeData,
      cost_function: {
        ...selectedEdgeData.cost_function,
        [field]: parseFloat(value) || 0
      }
    };
    setSelectedEdgeData(updated);
    setEdges(prev => prev.map(e => e.id === selectedEdge ? updated : e));
  };

  const deleteSelectedEdge = () => {
    setEdges(prev => prev.filter(e => e.id !== selectedEdge));
    setSelectedEdge(null);
    setSelectedEdgeData(null);
  };

  // ─────────────────────────────────────────────────────────────────────────
  // OD Pair Handlers
  // ─────────────────────────────────────────────────────────────────────────

  const addOdPair = () => {
    if (nodes.length < 2) return;
    setOdPairs(prev => [...prev, {
      id: generateId(),
      origin: nodes[0].id,
      destination: nodes[nodes.length - 1].id,
      demand: 10
    }]);
  };

  const updateOdPair = (id, field, value) => {
    setOdPairs(prev => prev.map(od => 
      od.id === id ? { ...od, [field]: field === 'demand' ? parseFloat(value) || 0 : value } : od
    ));
  };

  const deleteOdPair = (id) => {
    setOdPairs(prev => prev.filter(od => od.id !== id));
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Network Management
  // ─────────────────────────────────────────────────────────────────────────

  const loadPrebuiltNetwork = (network) => {
    setNodes(network.nodes);
    setEdges(network.edges);
    setOdPairs(network.od_pairs.map(od => ({ ...od, id: generateId() })));
    setNextNodeId(Math.max(...network.nodes.map(n => parseInt(n.id))) + 1);
    setResults(null);
    setSelectedEdge(null);
    setSelectedEdgeData(null);
  };

  const clearNetwork = () => {
    setNodes([]);
    setEdges([]);
    setOdPairs([]);
    setNextNodeId(1);
    setResults(null);
    setSelectedEdge(null);
    setSelectedEdgeData(null);
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Local Storage Persistence
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    try {
      const storedNetworks = localStorage.getItem('cg_saved_networks');
      if (storedNetworks) {
        setSavedNetworks(JSON.parse(storedNetworks));
      }
      const storedHistory = localStorage.getItem('cg_sim_history');
      if (storedHistory) {
        setSimulationHistory(JSON.parse(storedHistory));
      }
    } catch (storageError) {
      console.error('Failed to load saved data', storageError);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('cg_saved_networks', JSON.stringify(savedNetworks));
  }, [savedNetworks]);

  useEffect(() => {
    localStorage.setItem('cg_sim_history', JSON.stringify(simulationHistory));
  }, [simulationHistory]);

  const saveCurrentNetwork = () => {
    if (nodes.length === 0 || edges.length === 0) {
      setError('Add at least one node and one edge before saving.');
      return;
    }
    const entry = {
      id: generateId(),
      name: formatNetworkName(nodes.length, edges.length),
      createdAt: new Date().toISOString(),
      network: {
        nodes: nodes.map(n => ({ ...n })),
        edges: edges.map(e => ({ ...e })),
        od_pairs: odPairs.map(od => ({ ...od }))
      }
    };
    setSavedNetworks(prev => [entry, ...prev]);
  };

  const loadSavedNetwork = (entry) => {
    if (!entry?.network) return;
    setNodes(entry.network.nodes || []);
    setEdges(entry.network.edges || []);
    setOdPairs((entry.network.od_pairs || []).map(od => ({
      id: od.id || generateId(),
      origin: od.origin,
      destination: od.destination,
      demand: od.demand
    })));
    const maxNodeId = (entry.network.nodes || [])
      .map(n => parseInt(n.id, 10))
      .filter(n => !Number.isNaN(n));
    setNextNodeId(maxNodeId.length > 0 ? Math.max(...maxNodeId) + 1 : 1);
    setResults(null);
    setSelectedEdge(null);
    setSelectedEdgeData(null);
  };

  const deleteSavedNetwork = (id) => {
    setSavedNetworks(prev => prev.filter(entry => entry.id !== id));
  };

  const exportSavedNetworks = () => {
    downloadJson('congestion-networks.json', { networks: savedNetworks });
  };

  const exportHistory = () => {
    downloadJson('simulation-history.json', { history: simulationHistory });
  };

  const exportSession = () => {
    downloadJson('congestion-session.json', { networks: savedNetworks, history: simulationHistory });
  };

  const handleImport = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (Array.isArray(data.networks)) {
        setSavedNetworks(prev => [...data.networks, ...prev]);
      }
      if (Array.isArray(data.history)) {
        setSimulationHistory(prev => [...data.history, ...prev]);
      }
      if (data.nodes && data.edges && data.od_pairs) {
        const entry = {
          id: generateId(),
          name: formatNetworkName(data.nodes.length, data.edges.length),
          createdAt: new Date().toISOString(),
          network: {
            nodes: data.nodes,
            edges: data.edges,
            od_pairs: data.od_pairs
          }
        };
        setSavedNetworks(prev => [entry, ...prev]);
      }
    } catch (importError) {
      setError('Import failed. Please check the JSON file.');
    } finally {
      event.target.value = '';
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Computation
  // ─────────────────────────────────────────────────────────────────────────

  const computeEquilibrium = async () => {
    if (nodes.length < 2 || edges.length < 1 || odPairs.length < 1) {
      setError('Please add at least 2 nodes, 1 edge, and 1 OD pair');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const networkData = {
        nodes: nodes.map(n => ({ id: n.id, x: n.x, y: n.y })),
        edges: edges.map(e => ({
          id: e.id,
          source: e.source,
          target: e.target,
          cost_function: e.cost_function
        })),
        od_pairs: odPairs.map(od => ({
          origin: od.origin,
          destination: od.destination,
          demand: od.demand
        }))
      };

      const response = await axios.post(`${API_BASE_URL}/compute`, networkData);
      setResults(response.data);

      const historyEntry = {
        id: generateId(),
        name: formatNetworkName(nodes.length, edges.length),
        createdAt: new Date().toISOString(),
        network: networkData,
        results: response.data
      };
      setSimulationHistory(prev => [historyEntry, ...prev]);
    } catch (err) {
      setError(err.response?.data?.detail || 'Computation failed. Make sure the backend is running.');
    } finally {
      setLoading(false);
    }
  };

  // Auto-dismiss error
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  const currentResult = results
    ? (resultType === 'we' ? results.wardrop_equilibrium : results.system_optimum)
    : null;

  const currentEdgeResults = currentResult ? currentResult.edge_results : null;

  const routeLoadCharts = useMemo(() => {
    if (!currentResult?.path_flows?.length) return [];
    const groups = {};
    currentResult.path_flows.forEach((pf) => {
      if (!pf.path || pf.path.length < 2) return;
      const odKey = `${pf.path[0]}→${pf.path[pf.path.length - 1]}`;
      if (!groups[odKey]) groups[odKey] = [];
      groups[odKey].push({
        label: pf.path.join('→'),
        flow: pf.flow
      });
    });

    return Object.entries(groups).map(([odKey, flows]) => ({
      odKey,
      labels: flows.map(item => item.label),
      data: flows.map(item => item.flow)
    }));
  }, [currentResult]);

  return (
    <div className="app-container">
      {/* Sidebar */}
      <div className="sidebar">
        <div className="sidebar-header">
          <h1>Congestion Game Simulator</h1>
          <p>Wardrop Equilibrium & System Optimum</p>
        </div>

        <div className="sidebar-content">
          {/* Prebuilt Networks Section */}
          <div className="section">
            <div className="section-header">
              <h3>
                <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                  <path d="M2 17l10 5 10-5"/>
                  <path d="M2 12l10 5 10-5"/>
                </svg>
                Example Networks
              </h3>
            </div>
            <div className="section-content">
              <div className="prebuilt-networks">
                <button 
                  className="prebuilt-network-btn"
                  onClick={() => loadPrebuiltNetwork(BRAESS_PARADOX_NETWORK)}
                >
                  <strong>Braess Paradox</strong>
                  4 nodes, 5 edges
                </button>
                <button 
                  className="prebuilt-network-btn"
                  onClick={() => loadPrebuiltNetwork(PIGOU_NETWORK)}
                >
                  <strong>Pigou Network</strong>
                  4 nodes, 4 edges
                </button>
                <button 
                  className="prebuilt-network-btn"
                  onClick={() => loadPrebuiltNetwork(SIMPLE_TWO_PATH)}
                >
                  <strong>Simple Path</strong>
                  2 nodes, 1 edge
                </button>
                <button 
                  className="prebuilt-network-btn"
                  onClick={clearNetwork}
                >
                  <strong>Clear All</strong>
                  Start fresh
                </button>
              </div>
            </div>
          </div>

          {/* Edge Configuration Section */}
          <div className="section">
            <div className="section-header">
              <h3>
                <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2v4"/>
                  <path d="M12 18v4"/>
                  <circle cx="12" cy="12" r="4"/>
                </svg>
                Edge Configuration
              </h3>
              <span style={{ fontSize: '0.75rem', color: '#888' }}>{edges.length} edges</span>
            </div>
            <div className="section-content">
              {selectedEdgeData ? (
                <div>
                  <div className="edge-item selected">
                    <div className="edge-item-header">
                      <span>Edge: {selectedEdgeData.source} → {selectedEdgeData.target}</span>
                    </div>
                  </div>
                  
                  <div className="form-group" style={{ marginTop: '12px' }}>
                    <label>Function Type</label>
                    <select
                      value={selectedEdgeData.cost_function.function_type}
                      onChange={(e) => {
                        const updated = {
                          ...selectedEdgeData,
                          cost_function: { ...selectedEdgeData.cost_function, function_type: e.target.value }
                        };
                        setSelectedEdgeData(updated);
                        setEdges(prev => prev.map(ed => ed.id === selectedEdge ? updated : ed));
                      }}
                    >
                      <option value="polynomial">Polynomial: a·f^k + b</option>
                      <option value="bpr">BPR Function</option>
                    </select>
                  </div>

                  {selectedEdgeData.cost_function.function_type === 'polynomial' ? (
                    <>
                      <div className="form-group">
                        <label>Coefficients: t(f) = a · f^k + b</label>
                        <div className="input-row">
                          <div>
                            <input
                              type="number"
                              step="0.1"
                              value={selectedEdgeData.cost_function.a}
                              onChange={(e) => updateEdgeCostFunction('a', e.target.value)}
                              placeholder="a"
                            />
                            <span style={{ fontSize: '0.65rem', color: '#666' }}>a</span>
                          </div>
                          <div>
                            <input
                              type="number"
                              step="0.1"
                              value={selectedEdgeData.cost_function.k}
                              onChange={(e) => updateEdgeCostFunction('k', e.target.value)}
                              placeholder="k"
                            />
                            <span style={{ fontSize: '0.65rem', color: '#666' }}>k (power)</span>
                          </div>
                          <div>
                            <input
                              type="number"
                              step="0.1"
                              value={selectedEdgeData.cost_function.b}
                              onChange={(e) => updateEdgeCostFunction('b', e.target.value)}
                              placeholder="b"
                            />
                            <span style={{ fontSize: '0.65rem', color: '#666' }}>b (const)</span>
                          </div>
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="form-group">
                        <label>BPR Parameters</label>
                        <div className="input-row">
                          <div>
                            <input
                              type="number"
                              step="0.1"
                              value={selectedEdgeData.cost_function.free_flow_time}
                              onChange={(e) => updateEdgeCostFunction('free_flow_time', e.target.value)}
                            />
                            <span style={{ fontSize: '0.65rem', color: '#666' }}>Free flow time</span>
                          </div>
                          <div>
                            <input
                              type="number"
                              step="1"
                              value={selectedEdgeData.cost_function.capacity}
                              onChange={(e) => updateEdgeCostFunction('capacity', e.target.value)}
                            />
                            <span style={{ fontSize: '0.65rem', color: '#666' }}>Capacity</span>
                          </div>
                        </div>
                        <div className="input-row" style={{ marginTop: '8px' }}>
                          <div>
                            <input
                              type="number"
                              step="0.01"
                              value={selectedEdgeData.cost_function.alpha}
                              onChange={(e) => updateEdgeCostFunction('alpha', e.target.value)}
                            />
                            <span style={{ fontSize: '0.65rem', color: '#666' }}>α (0.15)</span>
                          </div>
                          <div>
                            <input
                              type="number"
                              step="0.1"
                              value={selectedEdgeData.cost_function.beta}
                              onChange={(e) => updateEdgeCostFunction('beta', e.target.value)}
                            />
                            <span style={{ fontSize: '0.65rem', color: '#666' }}>β (4)</span>
                          </div>
                        </div>
                      </div>
                    </>
                  )}

                  <button className="btn btn-danger btn-sm" onClick={deleteSelectedEdge}>
                    Delete Edge
                  </button>
                </div>
              ) : (
                <div className="instruction-text">
                  Select an edge on the canvas to configure its cost function
                </div>
              )}
            </div>
          </div>

          {/* OD Pairs Section */}
          <div className="section">
            <div className="section-header">
              <h3>
                <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 12h18"/>
                  <path d="M16 6l6 6-6 6"/>
                </svg>
                Origin-Destination Pairs
              </h3>
              <button className="btn btn-secondary btn-sm" onClick={addOdPair} disabled={nodes.length < 2}>
                + Add
              </button>
            </div>
            <div className="section-content">
              {odPairs.length === 0 ? (
                <div className="instruction-text">
                  Add OD pairs to define travel demand
                </div>
              ) : (
                <div className="od-list">
                  {odPairs.map(od => (
                    <div key={od.id} className="od-item">
                      <div className="od-item-header">
                        <span>{od.origin} → {od.destination}</span>
                        <button 
                          className="btn btn-danger btn-sm"
                          onClick={() => deleteOdPair(od.id)}
                          style={{ padding: '4px 8px' }}
                        >
                          ×
                        </button>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                        <select
                          value={od.origin}
                          onChange={(e) => updateOdPair(od.id, 'origin', e.target.value)}
                          style={{ padding: '6px', background: '#0f0f1a', border: '1px solid #2a2a4a', borderRadius: '4px', color: '#fff', fontSize: '0.75rem' }}
                        >
                          {nodes.map(n => (
                            <option key={n.id} value={n.id}>Origin: {n.id}</option>
                          ))}
                        </select>
                        <select
                          value={od.destination}
                          onChange={(e) => updateOdPair(od.id, 'destination', e.target.value)}
                          style={{ padding: '6px', background: '#0f0f1a', border: '1px solid #2a2a4a', borderRadius: '4px', color: '#fff', fontSize: '0.75rem' }}
                        >
                          {nodes.map(n => (
                            <option key={n.id} value={n.id}>Dest: {n.id}</option>
                          ))}
                        </select>
                      </div>
                      <div className="demand-slider">
                        <span style={{ fontSize: '0.7rem', color: '#888' }}>Demand:</span>
                        <input
                          type="range"
                          min="1"
                          max="100"
                          value={od.demand}
                          onChange={(e) => updateOdPair(od.id, 'demand', e.target.value)}
                        />
                        <input
                          type="number"
                          value={od.demand}
                          onChange={(e) => updateOdPair(od.id, 'demand', e.target.value)}
                          style={{ width: '60px', padding: '4px', background: '#0f0f1a', border: '1px solid #2a2a4a', borderRadius: '4px', color: '#fff', fontSize: '0.875rem', textAlign: 'right' }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Network Library Section */}
          <div className="section">
            <div className="section-header">
              <h3>
                <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 4h16v16H4z"/>
                  <path d="M8 8h8v8H8z"/>
                </svg>
                Network Library
              </h3>
              <button className="btn btn-secondary btn-sm" onClick={saveCurrentNetwork}>
                Save
              </button>
            </div>
            <div className="section-content">
              {savedNetworks.length === 0 ? (
                <div className="instruction-text">Saved networks will appear here</div>
              ) : (
                <div className="library-list">
                  {savedNetworks.map(entry => (
                    <div key={entry.id} className="library-item">
                      <div>
                        <div className="library-title">{entry.name}</div>
                        <div className="library-meta">{new Date(entry.createdAt).toLocaleString()}</div>
                      </div>
                      <div className="library-actions">
                        <button className="btn btn-secondary btn-sm" onClick={() => loadSavedNetwork(entry)}>Load</button>
                        <button className="btn btn-danger btn-sm" onClick={() => deleteSavedNetwork(entry.id)}>Delete</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="btn-group">
                <button className="btn btn-secondary btn-sm" onClick={exportSavedNetworks}>Export Networks</button>
                <button className="btn btn-secondary btn-sm" onClick={() => importInputRef.current?.click()}>Import JSON</button>
              </div>
              <input
                ref={importInputRef}
                type="file"
                accept="application/json"
                onChange={handleImport}
                style={{ display: 'none' }}
              />
            </div>
          </div>

          {/* Simulation History Section */}
          <div className="section">
            <div className="section-header">
              <h3>
                <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 8v5l3 3"/>
                  <circle cx="12" cy="12" r="9"/>
                </svg>
                Simulation History
              </h3>
              <button className="btn btn-secondary btn-sm" onClick={exportHistory}>
                Download All
              </button>
            </div>
            <div className="section-content">
              {simulationHistory.length === 0 ? (
                <div className="instruction-text">Run a simulation to start logging results</div>
              ) : (
                <div className="history-table">
                  <div className="history-row history-header">
                    <span>Network</span>
                    <span>PoA</span>
                    <span>WE</span>
                    <span>SO</span>
                    <span>Action</span>
                  </div>
                  {simulationHistory.map(entry => (
                    <div key={entry.id} className="history-row">
                      <span title={new Date(entry.createdAt).toLocaleString()}>{entry.name}</span>
                      <span>{entry.results?.price_of_anarchy?.toFixed(3) ?? '--'}</span>
                      <span>{entry.results?.wardrop_equilibrium?.total_system_cost?.toFixed(1) ?? '--'}</span>
                      <span>{entry.results?.system_optimum?.total_system_cost?.toFixed(1) ?? '--'}</span>
                      <button className="btn btn-danger btn-sm" onClick={() => setSimulationHistory(prev => prev.filter(item => item.id !== entry.id))}>Delete</button>
                    </div>
                  ))}
                </div>
              )}

              <div className="btn-group">
                <button className="btn btn-secondary btn-sm" onClick={exportSession}>Export Session</button>
              </div>
            </div>
          </div>

          {/* Compute Button */}
          <button 
            className="btn btn-primary btn-block"
            onClick={computeEquilibrium}
            disabled={loading || nodes.length < 2 || edges.length < 1 || odPairs.length < 1}
          >
            {loading ? (
              <>
                <div className="loading-spinner"></div>
                Computing...
              </>
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
                Calculate Equilibrium
              </>
            )}
          </button>
        </div>
      </div>

      {/* Main Canvas */}
      <div className="canvas-container">
        <div className="canvas-toolbar">
          <div className="toolbar-left">
            <div className="mode-toggle">
              <button 
                className={`mode-btn ${mode === 'addNode' ? 'active' : ''}`}
                onClick={() => setMode('addNode')}
              >
                Add Node
              </button>
              <button 
                className={`mode-btn ${mode === 'addEdge' ? 'active' : ''}`}
                onClick={() => setMode('addEdge')}
              >
                Add Edge
              </button>
              <button 
                className={`mode-btn ${mode === 'select' ? 'active' : ''}`}
                onClick={() => setMode('select')}
              >
                Select
              </button>
            </div>
          </div>
          <div className="toolbar-right">
            <span style={{ fontSize: '0.75rem', color: '#666' }}>
              {nodes.length} nodes, {edges.length} edges
            </span>
          </div>
        </div>

        <div className="canvas-area">
          <NetworkCanvas
            nodes={nodes}
            edges={edges}
            mode={mode}
            selectedEdge={selectedEdge}
            onAddNode={handleAddNode}
            onNodeClick={handleCreateEdge}
            onEdgeClick={handleEdgeClick}
            edgeResults={currentEdgeResults}
            showResults={!!results}
          />

          {/* Demand Panel */}
          <div className="demand-panel demand-panel--bottom-right">
            <div className="demand-panel-header">Demand Panel</div>
            {odPairs.length === 0 ? (
              <div className="demand-panel-empty">No OD pairs yet</div>
            ) : (
              <div className="demand-panel-list">
                {odPairs.map(od => (
                  <div key={od.id} className="demand-panel-item">
                    <div className="demand-panel-row">
                      <span className="demand-panel-od">{od.origin} → {od.destination}</span>
                      <div className="demand-panel-actions">
                        <button
                          className="demand-panel-value"
                          onClick={() => setDemandEditorId(prev => prev === od.id ? null : od.id)}
                        >
                          {od.demand}
                        </button>
                        <button className="btn btn-danger btn-sm" onClick={() => deleteOdPair(od.id)}>X</button>
                      </div>
                    </div>
                    {demandEditorId === od.id && (
                      <div className="demand-panel-editor">
                        <input
                          type="range"
                          min="1"
                          max="100"
                          value={od.demand}
                          onChange={(e) => updateOdPair(od.id, 'demand', e.target.value)}
                        />
                        <input
                          type="number"
                          value={od.demand}
                          onChange={(e) => updateOdPair(od.id, 'demand', e.target.value)}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Results Panel */}
          {results && (
            <div className="results-panel">
              <div className="results-header">
                <h3>Equilibrium Results</h3>
                <div className="results-tabs">
                  <button 
                    className={`results-tab ${resultType === 'we' ? 'active' : ''}`}
                    onClick={() => setResultType('we')}
                  >
                    Wardrop (UE)
                  </button>
                  <button 
                    className={`results-tab ${resultType === 'so' ? 'active' : ''}`}
                    onClick={() => setResultType('so')}
                  >
                    System Optimum
                  </button>
                </div>
              </div>
              <div className="results-content">
                <div className="results-grid">
                  <div className="result-card">
                    <div className="result-card-label">Price of Anarchy</div>
                    <div className="result-card-value poa">{results.price_of_anarchy.toFixed(4)}</div>
                  </div>
                  <div className="result-card">
                    <div className="result-card-label">WE Total Cost</div>
                    <div className="result-card-value we">{results.wardrop_equilibrium.total_system_cost.toFixed(2)}</div>
                  </div>
                  <div className="result-card">
                    <div className="result-card-label">SO Total Cost</div>
                    <div className="result-card-value so">{results.system_optimum.total_system_cost.toFixed(2)}</div>
                  </div>
                </div>

                <table className="results-table">
                  <thead>
                    <tr>
                      <th>Edge</th>
                      <th>Flow</th>
                      <th>Cost</th>
                      {resultType === 'so' && <th>Toll</th>}
                      <th>Congestion</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(resultType === 'we' ? results.wardrop_equilibrium : results.system_optimum).edge_results.map(edge => {
                      const edgeInfo = edges.find(e => e.id === edge.id);
                      return (
                        <tr key={edge.id}>
                          <td>{edgeInfo ? `${edgeInfo.source}→${edgeInfo.target}` : edge.id}</td>
                          <td>{edge.flow.toFixed(2)}</td>
                          <td>{edge.cost.toFixed(2)}</td>
                          {resultType === 'so' && <td>{edge.toll.toFixed(2)}</td>}
                          <td>
                            <div className="flow-bar">
                              <div 
                                className="flow-bar-fill"
                                style={{ 
                                  width: `${edge.congestion_level * 100}%`,
                                  backgroundColor: getCongestionColor(edge.congestion_level)
                                }}
                              />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {/* Path flows */}
                {(resultType === 'we' ? results.wardrop_equilibrium : results.system_optimum).path_flows.length > 0 && (
                  <div style={{ marginTop: '16px' }}>
                    <h4 style={{ fontSize: '0.75rem', color: '#888', marginBottom: '8px', textTransform: 'uppercase' }}>Path Flows</h4>
                    {(resultType === 'we' ? results.wardrop_equilibrium : results.system_optimum).path_flows.map((pf, idx) => (
                      <div key={idx} style={{ fontSize: '0.8rem', padding: '6px 0', borderBottom: '1px solid #2a2a4a' }}>
                        <span style={{ color: '#6366f1' }}>{pf.path.join(' → ')}</span>
                        <span style={{ float: 'right', color: '#10b981' }}>Flow: {pf.flow}</span>
                      </div>
                    ))}
                  </div>
                )}

                {routeLoadCharts.length > 0 && (
                  <div className="chart-section">
                    <h4>Route Load by OD Pair</h4>
                    <div className="chart-grid">
                      {routeLoadCharts.map(chart => (
                        <div key={chart.odKey} className="chart-card">
                          <div className="chart-title">{chart.odKey}</div>
                          <div className="chart-wrapper">
                            <Bar
                              data={{
                                labels: chart.labels,
                                datasets: [
                                  {
                                    label: 'Flow',
                                    data: chart.data,
                                    backgroundColor: 'rgba(99, 102, 241, 0.6)',
                                    borderColor: '#6366f1',
                                    borderWidth: 1
                                  }
                                ]
                              }}
                              options={{
                                responsive: true,
                                maintainAspectRatio: false,
                                plugins: {
                                  legend: {
                                    display: false
                                  },
                                  tooltip: {
                                    enabled: true
                                  }
                                },
                                scales: {
                                  x: {
                                    ticks: { color: '#c4c4d4', font: { size: 10 } },
                                    grid: { color: 'rgba(255,255,255,0.05)' }
                                  },
                                  y: {
                                    ticks: { color: '#c4c4d4', font: { size: 10 } },
                                    grid: { color: 'rgba(255,255,255,0.05)' }
                                  }
                                }
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Error Toast */}
      {error && (
        <div className="toast error">
          {error}
        </div>
      )}
    </div>
  );
}

export default App;
