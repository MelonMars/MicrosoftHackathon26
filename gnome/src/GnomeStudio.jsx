import React, { useState, useEffect, useRef } from "react";
import * as THREE from "three";
import ReactMarkdown from "react-markdown";
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const escapeHtml = (value) =>
  (value || "")
    .toString()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

export default function GnomeStudio() {
  const [problem, setProblem] = useState("");
  const [constraints, setConstraints] = useState("");
  const [targets, setTargets] = useState("");
  
  const [gnomeOutput, setGnomeOutput] = useState({ loading: false, data: [], error: null });
  const [activeMaterialIdx, setActiveMaterialIdx] = useState(0);
  const [porosity, setPorosity] = useState(40);

  // --- Chat State Layers ---
  const [chatInput, setChatInput] = useState("");
  const [chatHistory, setChatHistory] = useState([
    { role: "assistant", content: "Hello! Select a candidate material structure or ask me questions about custom **atomic lattices**." }
  ]);
  const [chatLoading, setChatLoading] = useState(false);

  const canvasRef = useRef(null);
  const sceneGroupRef = useRef(new THREE.Group());
  const chatEndRef = useRef(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory]);

  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f172a);
    
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.set(3, 3, 4);
    camera.lookAt(0, 0, 0);

    const ambient = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambient);
    const keyLight = new THREE.DirectionalLight(0xffffff, 0.9);
    keyLight.position.set(5, 8, 5);
    scene.add(keyLight);

    scene.add(sceneGroupRef.current);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    const handleResize = () => {
      if (!canvas.parentElement) return;
      const { clientWidth, clientHeight } = canvas.parentElement;
      renderer.setSize(clientWidth, clientHeight, false);
      camera.aspect = clientWidth / clientHeight;
      camera.updateProjectionMatrix();
    };
    
    handleResize();
    window.addEventListener("resize", handleResize);

    let animationFrameId;
    const animate = () => {
      sceneGroupRef.current.rotation.y += 0.005;
      sceneGroupRef.current.rotation.x += 0.002;
      renderer.render(scene, camera);
      animationFrameId = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      window.removeEventListener("resize", handleResize);
      cancelAnimationFrame(animationFrameId);
      renderer.dispose();
    };
  }, []);

  // Update 3D Grid / Molecule Structure mapping when selection alters
  useEffect(() => {
    const group = sceneGroupRef.current;
    
    while (group.children.length > 0) {
      const obj = group.children[0];
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
        else obj.material.dispose();
      }
      group.remove(obj);
    }

    const currentMaterial = gnomeOutput.data[activeMaterialIdx];

    if (!currentMaterial) {
      const geometry = new THREE.SphereGeometry(0.2, 16, 16);
      const material = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.5 });
      const visibleCount = Math.max(4, Math.round(27 * (1 - porosity / 100)));
      let added = 0;

      for (let x = -1; x <= 1; x++) {
        for (let y = -1; y <= 1; y++) {
          for (let z = -1; z <= 1; z++) {
            if (added >= visibleCount) break;
            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.set(x * 0.8, y * 0.8, z * 0.8);
            group.add(mesh);
            added++;
          }
        }
      }
      return;
    }

    const elementColors = { H: 0xffffff, C: 0x334155, O: 0xef4444, N: 0x3b82f6, P: 0xf59e0b };
    const sites = currentMaterial.sites || [];
    const sphereGeo = new THREE.SphereGeometry(0.22, 24, 24);

    sites.forEach((site) => {
      const color = elementColors[site.species] || 0x10b981; 
      const mat = new THREE.MeshStandardMaterial({ color, metalness: 0.2, roughness: 0.3 });
      const sphere = new THREE.Mesh(sphereGeo, mat);

      const px = (site.abc[0] - 0.5) * 2.5;
      const py = (site.abc[1] - 0.5) * 2.5;
      const pz = (site.abc[2] - 0.5) * 2.5;
      
      sphere.position.set(px, py, pz);
      group.add(sphere);
    });

    const lineMat = new THREE.LineBasicMaterial({ color: 0x475569, transparent: true, opacity: 0.4 });
    const boxGeo = new THREE.BoxGeometry(2.5, 2.5, 2.5);
    const edges = new THREE.EdgesGeometry(boxGeo);
    const line = new THREE.LineSegments(edges, lineMat);
    group.add(line);

  }, [gnomeOutput.data, activeMaterialIdx, porosity]);

  const handleGnomeSubmit = async (e) => {
    e.preventDefault();
    setGnomeOutput({ loading: true, data: [], error: null });
    setActiveMaterialIdx(0);
  
    try {
      const response = await fetch("http://127.0.0.1:8000/materials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ problem, constraints, targetProperties: targets }),
      });
  
      if (!response.ok) throw new Error("Server error");
  
      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";
  
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
  
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop();
  
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const rawJson = line.replace("data: ", "").trim();
            if (!rawJson) continue;
  
            const parsedItem = JSON.parse(rawJson);
            if (parsedItem.error) {
              setGnomeOutput(prev => ({ ...prev, error: parsedItem.error, loading: false }));
              return;
            }
  
            setGnomeOutput((prev) => ({
              loading: true,
              error: null,
              data: [...prev.data, parsedItem]
            }));
          }
        }
      }
      setGnomeOutput(prev => ({ ...prev, loading: false }));
    } catch (error) {
      setGnomeOutput(prev => ({ ...prev, loading: false, error: "Stream interrupted." }));
    }
  };

  const currentSelection = gnomeOutput.data[activeMaterialIdx];

  // --- Chat Submission Handler ---
  const handleChatSubmit = async (e) => {
    e.preventDefault();
    if (!chatInput.trim() || chatLoading) return;

    const userMessage = { role: "user", content: chatInput };
    setChatHistory((prev) => [...prev, userMessage]);
    setChatInput("");
    setChatLoading(true);

    const chatContext = currentSelection ? {
      id: currentSelection.id,
      formula: currentSelection.formula,
      bandGap: currentSelection.bandGap,
      sites_count: currentSelection.sites?.length || 0
    } : null;

    try {
      const response = await fetch("http://127.0.0.1:8000/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...chatHistory, userMessage],
          currentMaterial: chatContext,
          searchTerm: problem
        })
      });

      if (!response.ok) throw new Error("Chat engine connection failure");

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let assistantMessage = { role: "assistant", content: "" };
      
      setChatHistory((prev) => [...prev, assistantMessage]);
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          // FLUSH THE REMAINING BUFFER BEFORE BREAKING
          if (buffer.trim().startsWith("data: ")) {
            const rawJson = buffer.replace("data: ", "").trim();
            if (rawJson) {
              const parsedItem = JSON.parse(rawJson);
              setGnomeOutput((prev) => ({
                ...prev,
                data: [...prev.data, parsedItem]
              }));
            }
          }
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const rawJson = line.replace("data: ", "").trim();
            if (!rawJson) continue;

            const parsedItem = JSON.parse(rawJson);
            if (parsedItem.error) {
              setGnomeOutput(prev => ({ ...prev, error: parsedItem.error, loading: false }));
              return;
            }

            setGnomeOutput((prev) => ({
              loading: true,
              error: null,
              data: [...prev.data, parsedItem]
            }));
          }
        }
      }
    } catch (err) {
      setChatHistory((prev) => [
        ...prev,
        { role: "assistant", content: "Error resolving reasoning matrices from the LLM core system." }
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  return (
    <>
      <header className="hero" style={{ padding: '1rem 2rem', borderBottom: '1px solid #334155' }}>
        <div>
          <p className="eyebrow" style={{ color: '#60a5fa', margin: 0 }}>AI-assisted materials discovery</p>
          <h1 style={{ margin: '0.25rem 0' }}>Gnome Materials Studio</h1>
        </div>
      </header>

      <main style={{ maxWidth: '1600px', margin: '0 auto', padding: '1rem' }}>
        <div className="layout-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1.3fr', gap: '1.5rem', height: 'calc(100vh - 140px)' }}>
          
          {/* LEFT SIDE COLUMN: Parameters + Selection + Analysis Stack */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', overflowY: 'auto', pr: '0.5rem' }}>
            
            {/* Panel 1: Input controls */}
            <section className="panel" style={{ background: '#1e293b', padding: '1.25rem', borderRadius: '8px' }}>
              <h2 style={{ fontSize: '1.1rem', marginTop: 0 }}>1. Define Parameters</h2>
              <form onSubmit={handleGnomeSubmit}>
                <div style={{ marginBottom: '0.75rem' }}>
                  <textarea
                    id="problem"
                    rows="2"
                    placeholder="Describe problem statement here..."
                    style={{ width: '100%', background: '#0f172a', color: '#fff', border: '1px solid #334155', padding: '.5rem', borderRadius: '4px' }}
                    value={problem}
                    onChange={(e) => setProblem(e.target.value)}
                    required
                  />
                </div>
                <button type="submit" style={{ width: '100%', background: '#3b82f6', color: '#fff', border: 'none', padding: '.6rem', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>
                  {gnomeOutput.loading ? "Streaming Components..." : "Query Lattice Formations"}
                </button>
              </form>
            </section>

            {/* Panel 2: Candidate Selection Grid */}
            <section className="panel" style={{ background: '#1e293b', padding: '1.25rem', borderRadius: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={{ fontSize: '1.1rem', margin: 0 }}>2. Discovered Systems</h2>
                {gnomeOutput.data.length > 0 && (
                  <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                    {activeMaterialIdx + 1} / {gnomeOutput.data.length}
                  </span>
                )}
              </div>

              {gnomeOutput.data.length === 0 ? (
                <p style={{ color: '#64748b', fontSize: '0.9rem', marginTop: '0.75rem', marginBottom: 0 }}>No system data actively searched yet.</p>
              ) : (
                <div style={{ marginTop: '0.75rem' }}>
                  <div style={{ display: 'flex', gap: '.5rem', marginBottom: '0.75rem' }}>
                    <button 
                      disabled={activeMaterialIdx === 0} 
                      onClick={() => setActiveMaterialIdx(p => p - 1)}
                      style={{ flex: 1, padding: '.4rem', background: '#334155', color: '#fff', border: 'none', cursor: 'pointer', borderRadius: '4px', fontSize: '0.85rem' }}
                    >
                      ← Prev
                    </button>
                    <button 
                      disabled={activeMaterialIdx === gnomeOutput.data.length - 1} 
                      onClick={() => setActiveMaterialIdx(p => p + 1)}
                      style={{ flex: 1, padding: '.4rem', background: '#334155', color: '#fff', border: 'none', cursor: 'pointer', borderRadius: '4px', fontSize: '0.85rem' }}
                    >
                      Next →
                    </button>
                  </div>

                  {currentSelection && (
                    <div style={{ background: '#0f172a', padding: '1rem', borderRadius: '6px', fontSize: '0.85rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                        <h3 style={{ color: '#60a5fa', margin: 0, fontSize: '1.1rem' }}>
                          Formula: {escapeHtml(currentSelection.formula)}
                        </h3>
                        <span style={{ background: '#1e293b', padding: '2px 6px', borderRadius: '4px', fontSize: '0.75rem', color: '#10b981', border: '1px solid #334155' }}>
                          ID: {escapeHtml(currentSelection.id)}
                        </span>
                      </div>
                      
                      {/* Property 1: Band Gap bar mapping */}
                      <div style={{ marginBottom: '0.5rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#94a3b8', marginBottom: '2px' }}>
                          <span>Band Gap Energy</span>
                          <span style={{ color: '#fff' }}>{currentSelection.bandGap} eV</span>
                        </div>
                        <div style={{ background: '#334155', height: '6px', borderRadius: '3px', overflow: 'hidden' }}>
                          <div style={{ 
                            background: '#f59e0b', 
                            height: '100%', 
                            // Clamps the bandgap representation assuming a max typical score scale of ~5eV for UI visuals
                            width: `${Math.min(100, (currentSelection.bandGap / 5) * 100)}%` 
                          }} />
                        </div>
                      </div>

                      {/* Property 2: Geometric Complexity mapping */}
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#94a3b8', marginBottom: '2px' }}>
                          <span>Atomic Basis Complexity</span>
                          <span style={{ color: '#fff' }}>{currentSelection.sites?.length || 0} sites</span>
                        </div>
                        <div style={{ background: '#334155', height: '6px', borderRadius: '3px', overflow: 'hidden' }}>
                          <div style={{ 
                            background: '#3b82f6', 
                            height: '100%', 
                            width: `${Math.min(100, ((currentSelection.sites?.length || 4) / 32) * 100)}%` 
                          }} />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* Panel 3: Written Analysis AI Engine */}
            <section className="panel" style={{ background: '#1e293b', padding: '1.25rem', borderRadius: '8px', flex: 1, display: 'flex', flexDirection: 'column', minHeight: '300px' }}>
              <h2 style={{ fontSize: '1.1rem', marginTop: 0, marginBottom: '0.25rem' }}>3. AI Analysis & Reasoning</h2>
              <p style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: '0.75rem' }}>Ask why this compound functions, its stability limits, or processing pathways.</p>
              
              {/* Message History Feed */}
              <div style={{ flex: 1, background: '#0f172a', borderRadius: '6px', padding: '0.75rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '350px' }}>
                {chatHistory.map((msg, idx) => (
                  <div key={idx} style={{ alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '90%' }}>
                    <div style={{ fontSize: '0.7rem', color: '#64748b', textAlign: msg.role === 'user' ? 'right' : 'left', marginBottom: '0.1rem' }}>
                      {msg.role === 'user' ? 'You' : 'Gnome AI'}
                    </div>
                    {/* 2. Swapped text block for <ReactMarkdown> wrapper & injected styling overrides for strict clean layout layout */}
                    <div className="markdown-chat-bubble" style={{ background: msg.role === 'user' ? '#2563eb' : '#334155', color: '#fff', padding: '0.5rem 0.7rem', borderRadius: '8px', fontSize: '0.85rem' }}>
                      <ReactMarkdown 
                        components={{
                          p: ({node, ...props}) => <p style={{ margin: '0 0 0.5rem 0' }} {...props} />,
                          ul: ({node, ...props}) => <ul style={{ margin: '0 0 0.5rem 0', paddingLeft: '1.2rem' }} {...props} />,
                          ol: ({node, ...props}) => <ol style={{ margin: '0 0 0.5rem 0', paddingLeft: '1.2rem' }} {...props} />,
                          li: ({node, ...props}) => <li style={{ marginBottom: '0.25rem' }} {...props} />,
                          code: ({node, ...props}) => <code style={{ background: '#0f172a', padding: '2px 4px', borderRadius: '3px', fontFamily: 'monospace' }} {...props} />
                        }}
                      >
                        {msg.content}
                      </ReactMarkdown>
                    </div>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>

              {/* Interaction Bar */}
              <form onSubmit={handleChatSubmit} style={{ display: 'flex', marginTop: '0.75rem', gap: '0.4rem' }}>
                <input 
                  type="text" 
                  placeholder={currentSelection ? `Ask about ${currentSelection.formula}...` : "Ask a materials question..."}
                  style={{ flex: 1, background: '#0f172a', border: '1px solid #334155', color: '#fff', padding: '0.5rem', borderRadius: '4px', fontSize: '0.85rem' }}
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                />
                <button 
                  type="submit" 
                  disabled={chatLoading}
                  style={{ background: '#10b981', color: '#fff', border: 'none', padding: '0 0.8rem', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem' }}
                >
                  {chatLoading ? "..." : "Ask"}
                </button>
              </form>
            </section>
          </div>

          <div style={{ background: '#1e293b', padding: '1.25rem', borderRadius: '8px', display: 'flex', flexDirection: 'column' }}>
            <h2 style={{ fontSize: '1.2rem', marginTop: 0, marginBottom: '0.25rem' }}>4. Interactive Atomic Lattice Renderer</h2>
            <p style={{ fontSize: '0.85rem', color: '#94a3b8', margin: '0 0 1rem 0' }}>
              {currentSelection 
                ? `Displaying unit crystal configuration space properties for ${currentSelection.formula}.`
                : "Displaying placeholder uniform macro-porous material layout structure geometry."}
            </p>

            <div style={{ flex: 1, background: '#0f172a', position: 'relative', borderRadius: '6px', overflow: 'hidden' }}>
              <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
            </div>
          </div>

        </div>
      </main>
    </>
  );
}