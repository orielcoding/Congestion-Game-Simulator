import React, { useState, useCallback, useRef, useEffect } from 'react';
import axios from 'axios';

// API Configuration
const API_BASE_URL = 'http://localhost:8000';

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
  showResults,
  resultType
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
                x="-30"
                y="-12"
                width="60"
                height="24"
                fill="rgba(10, 10, 20, 0.9)"
                rx="4"
              />
              <text
                textAnchor="middle"
                dy="4"
                fill="#e0e0e0"
                fontSize="10"
                fontFamily="Inter, sans-serif"
              >
                {result ? `f=${result.flow.toFixed(1)}` : `t=${edge.cost_function.a}f${edge.cost_function.k > 0 ? `^${edge.cost_function.k}` : ''}+${edge.cost_function.b}`}
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

  const currentEdgeResults = results 
    ? (resultType === 'we' ? results.wardrop_equilibrium.edge_results : results.system_optimum.edge_results)
    : null;

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
            resultType={resultType}
          />

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
