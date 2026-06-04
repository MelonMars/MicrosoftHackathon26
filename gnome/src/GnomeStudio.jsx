import React, { useState, useEffect, useRef } from "react";
import * as THREE from "three";

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
  const [paperQuery, setPaperQuery] = useState("");
  const [paperResults, setPaperResults] = useState({ loading: false, data: null, error: null });
  const [recipe, setRecipe] = useState({ loading: false, data: null, error: null });
  const [porosity, setPorosity] = useState(40);

  const canvasRef = useRef(null);
  const sceneGroupRef = useRef(new THREE.Group());

  // Three.js Scene Setup Engine
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

    // Add our atomic group to the main scene
    scene.add(sceneGroupRef.current);

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
    
    // Clear old children
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

    // Fallback Mock Lattice Model if backend data has not been pulled yet
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

    // Color mapper for chemical elements
    const elementColors = {
      H: 0xffffff,
      C: 0x334155,
      O: 0xef4444,
      N: 0x3b82f6,
      P: 0xf59e0b
    };

    // Build real unit lattice coordinates from Materials Project Data stream
    const sites = currentMaterial.sites || [];
    const sphereGeo = new THREE.SphereGeometry(0.22, 24, 24);

    sites.forEach((site) => {
      const color = elementColors[site.species] || 0x10b981; // Fallback emerald green
      const mat = new THREE.MeshStandardMaterial({ color, metalness: 0.2, roughness: 0.3 });
      const sphere = new THREE.Mesh(sphereGeo, mat);

      // Fractional to Cartesian Mapping adjustments (centered at 0,0,0)
      const px = (site.abc[0] - 0.5) * 2.5;
      const py = (site.abc[1] - 0.5) * 2.5;
      const pz = (site.abc[2] - 0.5) * 2.5;
      
      sphere.position.set(px, py, pz);
      group.add(sphere);
    });

    // Draw unit box wire lines connecting structures
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

  const handlePaperSearch = async () => {
    if (!paperQuery.trim()) return;
    setPaperResults({ loading: true, data: null, error: null });
    // Mock Paper fetch execution loop can be safely un-commented out here if handling citation structures
  };

  const currentSelection = gnomeOutput.data[activeMaterialIdx];

  return (
    <>
      <header className="hero">
        <div>
          <p className="eyebrow">AI-assisted materials discovery</p>
          <h1>Gnome Materials Studio</h1>
          <p className="subhead">Define target properties, fetch crystalline compositions, and isolate structures interactively.</p>
        </div>
      </header>

      <main style={{ maxWidth: '1200px', margin: '0 auto', padding: '1rem' }}>
        <div className="layout-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
          
          {/* LEFT: Control Form & Paginated Stream UI Card */}
          <div className="left-column">
            <section className="panel" style={{ background: '#1e293b', padding: '1.5rem', borderRadius: '8px', marginBottom: '1.5rem' }}>
              <h2>1. Define Parameters</h2>
              <form onSubmit={handleGnomeSubmit}>
                <div style={{ marginBottom: '1rem' }}>
                  <label htmlFor="problem" style={{ display: 'block', marginBottom: '.5rem' }}>Problem Statement</label>
                  <textarea
                    id="problem"
                    rows="2"
                    style={{ width: '100%', background: '#0f172a', color: '#fff', border: '1px solid #334155', padding: '.5rem' }}
                    value={problem}
                    onChange={(e) => setProblem(e.target.value)}
                    required
                  />
                </div>
                <button type="submit" style={{ background: '#3b82f6', color: '#fff', border: 'none', padding: '.75rem 1.5rem', borderRadius: '4px', cursor: 'pointer' }}>
                  {gnomeOutput.loading ? "Streaming Components..." : "Query Lattice Formations"}
                </button>
              </form>
            </section>

            {/* Pagination Controls & Cards panel view */}
            <section className="panel" style={{ background: '#1e293b', padding: '1.5rem', borderRadius: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2>2. Discovered Materials Selection</h2>
                {gnomeOutput.data.length > 0 && (
                  <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
                    Record {activeMaterialIdx + 1} of {gnomeOutput.data.length}
                  </span>
                )}
              </div>

              {gnomeOutput.data.length === 0 ? (
                <p style={{ color: '#64748b' }}>No system data actively searched yet.</p>
              ) : (
                <div>
                  {/* Slider Pagination Toolbar */}
                  <div style={{ display: 'flex', gap: '.5rem', margin: '1rem 0' }}>
                    <button 
                      disabled={activeMaterialIdx === 0} 
                      onClick={() => setActiveMaterialIdx(p => p - 1)}
                      style={{ flex: 1, padding: '.5rem', background: '#334155', color: '#fff', border: 'none', cursor: 'pointer' }}
                    >
                      ← Previous Candidate
                    </button>
                    <button 
                      disabled={activeMaterialIdx === gnomeOutput.data.length - 1} 
                      onClick={() => setActiveMaterialIdx(p => p + 1)}
                      style={{ flex: 1, padding: '.5rem', background: '#334155', color: '#fff', border: 'none', cursor: 'pointer' }}
                    >
                      Next Candidate →
                    </button>
                  </div>

                  {currentSelection && (
                    <div style={{ background: '#0f172a', padding: '1rem', borderRadius: '6px' }}>
                      <h3 style={{ color: '#60a5fa', margin: '0 0 .5rem 0' }}>Formula: {escapeHtml(currentSelection.formula)}</h3>
                      <p><strong>Materials Project ID:</strong> {escapeHtml(currentSelection.id)}</p>
                      <p><strong>Electronic Band Gap:</strong> {currentSelection.bandGap} eV</p>
                      <p><strong>Total Unit Cell Atoms:</strong> {currentSelection.sites?.length}</p>
                    </div>
                  )}
                </div>
              )}
            </section>
          </div>

          {/* RIGHT: Atomic Render Viewport Panel */}
          <div className="right-column">
            <section className="panel" style={{ background: '#1e293b', padding: '1.5rem', borderRadius: '8px', height: '100%', display: 'flex', flexDirection: 'column' }}>
              <h2>3. Interactive Atomic Lattice Renderer</h2>
              <p style={{ fontSize: '0.9rem', color: '#94a3b8' }}>
                {currentSelection 
                  ? `Displaying unit crystal configuration vector space properties for ${currentSelection.formula}.`
                  : "Displaying placeholder uniform macro-porous material layout structure geometry."}
              </p>

              <div style={{ flex: 1, minHeight: '350px', background: '#0f172a', position: 'relative', borderRadius: '6px', overflow: 'hidden' }}>
                <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
              </div>

              {!currentSelection && (
                <div style={{ marginTop: '1rem' }}>
                  <label htmlFor="porosity">Adjust Structural Porosity Vector: {porosity}%</label>
                  <input 
                    id="porosity" 
                    type="range" 
                    min="0" 
                    max="100" 
                    style={{ width: '100%' }}
                    value={porosity} 
                    onChange={(e) => setPorosity(Number(e.target.value))}
                  />
                </div>
              )}
            </section>
          </div>

        </div>
      </main>
    </>
  );
}