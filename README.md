# Congestion Game Simulator

A web-based application for designing transportation networks, computing Wardrop Equilibrium (User Equilibrium) and System Optimum with Optimal Tolls.

![Congestion Game Simulator](https://via.placeholder.com/800x400?text=Congestion+Game+Simulator)

## Features

- **Interactive Network Builder**: Click to add nodes, drag between nodes to create directed edges
- **Cost Function Editor**: Configure polynomial (`t(f) = a·f^k + b`) or BPR cost functions for each edge
- **Origin-Destination Manager**: Define OD pairs with adjustable demand using sliders
- **Dual Equilibrium Computation**:
  - **Wardrop Equilibrium (User Equilibrium)**: Flow distribution where no user can reduce travel time
  - **System Optimum**: Flows that minimize total system travel time
- **Optimal Toll Calculation**: Marginal cost pricing (`τ = f · t'(f)`)
- **Visualization**: Color-coded edges based on congestion levels (green → red)
- **Price of Anarchy**: Compare efficiency of selfish routing vs. optimal routing
- **Prebuilt Examples**: Braess Paradox, Pigou Network, and Simple Path networks

## Technical Stack

### Frontend
- React.js 18
- SVG-based graph visualization
- Axios for API communication

### Backend
- Python FastAPI
- Frank-Wolfe algorithm for traffic assignment
- NetworkX for graph operations and path finding
- NumPy/SciPy for numerical optimization

## Installation

### Prerequisites
- Node.js 16+ and npm
- Python 3.8+
- pip

### Backend Setup

```bash
cd backend

# Create virtual environment (recommended)
python -m venv venv

# Activate virtual environment
# On Windows:
venv\Scripts\activate
# On macOS/Linux:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Run the server
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

The API will be available at `http://localhost:8000`

### Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Start development server
npm start
```

The application will open at `http://localhost:3000`

## Usage

### 1. Build Your Network

1. Click **"Add Node"** mode and click on the canvas to place nodes
2. Click **"Add Edge"** mode, then click a source node followed by a target node to create directed edges
3. Click **"Select"** mode to click on edges and configure their cost functions

### 2. Configure Cost Functions

For each edge, choose between:

- **Polynomial**: `t(f) = a · f^k + b`
  - `a`: coefficient for flow term
  - `k`: power/exponent
  - `b`: constant term

- **BPR Function**: `t(f) = T₀ · (1 + α · (f/C)^β)`
  - `T₀`: free-flow travel time
  - `C`: capacity
  - `α`: typically 0.15
  - `β`: typically 4

### 3. Define OD Pairs

1. Click **"+ Add"** in the Origin-Destination Pairs section
2. Select origin and destination nodes
3. Adjust demand using the slider or input field

### 4. Compute Equilibrium

Click **"Calculate Equilibrium"** to compute:
- Wardrop (User) Equilibrium
- System Optimum with Optimal Tolls
- Price of Anarchy

### 5. Analyze Results

- Toggle between **Wardrop (UE)** and **System Optimum** views
- Edges are color-coded by congestion (green = low, red = high)
- View flow and cost for each edge
- See path-level flow distribution

## Example: Braess Paradox

Click **"Braess Paradox"** in the Example Networks section to load a classic network demonstrating how adding a road can increase overall travel time.

Network structure:
```
    (2)
   ↗   ↘
(1)  →  (4)
   ↘   ↗
    (3)
```

Edge cost functions:
- Edge 1→2: `t(f) = f` (flow-dependent)
- Edge 1→3: `t(f) = 45` (constant)
- Edge 2→4: `t(f) = 45` (constant)
- Edge 3→4: `t(f) = f` (flow-dependent)
- Edge 2→3: `t(f) = 0` (free road)

With 60 units of demand from node 1 to node 4, the equilibrium flow uses the free middle road, resulting in higher total cost than if it didn't exist!

## API Endpoints

### `POST /compute`
Compute Wardrop Equilibrium and System Optimum.

**Request Body:**
```json
{
  "nodes": [
    {"id": "1", "x": 100, "y": 200},
    {"id": "2", "x": 300, "y": 200}
  ],
  "edges": [
    {
      "id": "e1",
      "source": "1",
      "target": "2",
      "cost_function": {
        "a": 1,
        "k": 1,
        "b": 0,
        "function_type": "polynomial"
      }
    }
  ],
  "od_pairs": [
    {"origin": "1", "destination": "2", "demand": 10}
  ]
}
```

**Response:**
```json
{
  "wardrop_equilibrium": {
    "edge_results": [...],
    "path_flows": [...],
    "total_system_cost": 100.0,
    "od_costs": {"1->2": 10.0}
  },
  "system_optimum": {...},
  "price_of_anarchy": 1.25,
  "optimal_tolls": {"e1": 5.0}
}
```

### `POST /validate`
Validate network structure and connectivity.

## Mathematical Background

### Wardrop Equilibrium (User Equilibrium)
Minimizes the Beckmann objective:
$$\min \sum_{e} \int_{0}^{f_e} t_e(s) \, ds$$

At equilibrium, all used paths between an OD pair have equal cost, and no unused path has lower cost.

### System Optimum
Minimizes total system travel time:
$$\min \sum_{e} f_e \cdot t_e(f_e)$$

### Optimal Tolls
Using marginal cost pricing:
$$\tau_e = f_e \cdot t'_e(f_e)$$

### Price of Anarchy
$$PoA = \frac{\text{Total Cost at Wardrop Equilibrium}}{\text{Total Cost at System Optimum}}$$

## License

MIT License
