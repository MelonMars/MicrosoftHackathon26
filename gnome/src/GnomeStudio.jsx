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
  
  const [gnomeOutput, setGnomeOutput] = useState({ loading: false, data: null, error: null });
  const [paperQuery, setPaperQuery] = useState("");
  const [paperResults, setPaperResults] = useState({ loading: false, data: null, error: null });
  const [recipe, setRecipe] = useState({ loading: true, data: null, error: null });
  const [porosity, setPorosity] = useState(40);

  const canvasRef = useRef(null);
  const spheresRef = useRef([]);

  // useEffect(() => {
  //   const loadRecipe = async () => {
  //     try {
  //       const response = await fetch("/api/recipe");
  //       if (!response.ok) throw new Error();
  //       const data = await response.json();
  //       setRecipe({ loading: false, data, error: null });
  //     } catch {
  //       setRecipe({ loading: false, data: null, error: "Recipe unavailable." });
  //     }
  //   };
  //   loadRecipe();
  // }, []);

  useEffect(() => {
    if (!canvasRef.current || !window.THREE) return;

    const THREE = window.THREE;
    const canvas = canvasRef.current;
    
    // Setup renderer, scene, and camera
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f172a);
    
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.set(4, 3.5, 5);

    // Lighting
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambient);
    const keyLight = new THREE.DirectionalLight(0xffffff, 0.8);
    keyLight.position.set(3, 4, 5);
    scene.add(keyLight);

    // Object Group Setup
    const group = new THREE.Group();
    const localSpheres = [];
    const geometry = new THREE.SphereGeometry(0.35, 24, 24);
    const material = new THREE.MeshStandardMaterial({
      color: 0x7aa2ff,
      roughness: 0.4,
      metalness: 0.1,
    });

    // Generate grid
    for (let x = -1; x <= 1; x += 1) {
      for (let y = -1; y <= 1; y += 1) {
        for (let z = -1; z <= 1; z += 1) {
          const sphere = new THREE.Mesh(geometry, material);
          sphere.position.set(x, y, z);
          group.add(sphere);
          localSpheres.push(sphere);
        }
      }
    }
    scene.add(group);
    spheresRef.current = localSpheres;

    // Trigger initial visibility sync matching current state porosity
    updateSphereVisibility(porosity);

    // Resize Handler
    const handleResize = () => {
      if (!canvas.parentElement) return;
      const { clientWidth, clientHeight } = canvas.parentElement;
      renderer.setSize(clientWidth, clientHeight, false);
      camera.aspect = clientWidth / clientHeight;
      camera.updateProjectionMatrix();
    };
    
    handleResize();
    window.addEventListener("resize", handleResize);

    // Animation Ticker
    let animationFrameId;
    const animate = () => {
      group.rotation.y += 0.004;
      group.rotation.x += 0.002;
      renderer.render(scene, camera);
      animationFrameId = requestAnimationFrame(animate);
    };
    animate();

    // Cleanup functions when the component unmounts
    return () => {
      window.removeEventListener("resize", handleResize);
      cancelAnimationFrame(animationFrameId);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    };
  }, []);

  // --- Helper: Update Three.js Sphere Visibility via React State Alteration ---
  const updateSphereVisibility = (porosityValue) => {
    const spheres = spheresRef.current;
    if (!spheres.length) return;
    const total = spheres.length;
    const visibleCount = Math.max(4, Math.round(total * (1 - porosityValue / 100)));
    spheres.forEach((sphere, index) => {
      sphere.visible = index < visibleCount;
    });
  };

  // Synchronize dynamic visibility when slider updates
  const handlePorosityChange = (e) => {
    const val = Number(e.target.value);
    setPorosity(val);
    updateSphereVisibility(val);
  };

  // --- Form Handler: Submit Problem Statement ---
  const handleGnomeSubmit = async (e) => {
    e.preventDefault();
    setGnomeOutput({ loading: true, data: [], error: null }); // Notice data is now an array
  
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
  
        // Append incoming stream chunk to text buffer
        buffer += decoder.decode(value, { stream: true });
        
        // Split chunks by SSE boundary markers
        const lines = buffer.split("\n\n");
        buffer = lines.pop(); // Keep incomplete trailing lines in buffer
  
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const rawJson = line.replace("data: ", "").trim();
            if (!rawJson) continue;
  
            const parsedItem = JSON.parse(rawJson);
            
            if (parsedItem.error) {
              setGnomeOutput(prev => ({ ...prev, error: parsedItem.error, loading: false }));
              return;
            }
  
            // Progressively append items into state array
            setGnomeOutput((prev) => ({
              loading: true, // keep true while streaming
              error: null,
              data: prev.data ? [...prev.data, parsedItem] : [parsedItem]
            }));
          }
        }
      }
  
      // Streaming successfully finished
      setGnomeOutput(prev => ({ ...prev, loading: false }));
  
    } catch (error) {
      setGnomeOutput({ loading: false, data: null, error: "Stream interrupted." });
    }
  };

  // --- Action Handler: Search Academic Papers ---
  const handlePaperSearch = async () => {
    if (!paperQuery.trim()) {
      setPaperResults({ loading: false, data: null, error: "Enter a search term to find papers." });
      return;
    }

    setPaperResults({ loading: true, data: null, error: null });

    // try {
    //   const response = await fetch(`/api/papers?query=${encodeURIComponent(paperQuery.trim())}`);
    //   if (!response.ok) throw new Error();
    //   const data = await response.json();

    //   if (!data.papers?.length) {
    //     setPaperResults({ loading: false, data: null, error: "No papers found. Try another query." });
    //   } else {
    //     setPaperResults({ loading: false, data: data.papers, error: null });
    //   }
    // } catch {
    //   setPaperResults({ loading: false, data: null, error: "Paper search is unavailable right now." });
    // }
  };

  return (
    <>
      <header className="hero">
        <div>
          <p className="eyebrow">AI-assisted materials discovery</p>
          <h1>Gnome Materials Studio</h1>
          <p className="subhead">
            Define a sustainable packaging challenge, search academic literature, and visualize a 3D material concept.
          </p>
        </div>
      </header>

      <main>
        {/* Section 1: Describe Problem */}
        <section className="panel">
          <h2>1. Describe the problem</h2>
          <form id="gnome-form" onSubmit={handleGnomeSubmit}>
            <label htmlFor="problem">Problem statement</label>
            <textarea
              id="problem"
              rows="3"
              placeholder="Example: Replace petroleum-based clamshell packaging with a compostable alternative that resists grease."
              value={problem}
              onChange={(e) => setProblem(e.target.value)}
              required
            />

            <div className="grid">
              <div>
                <label htmlFor="constraints">Constraints</label>
                <input
                  id="constraints"
                  type="text"
                  placeholder="Food contact safe, low cost, industrial compostable"
                  value={constraints}
                  onChange={(e) => setConstraints(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="targets">Target properties</label>
                <input
                  id="targets"
                  type="text"
                  placeholder="Grease resistance, stiffness, heat tolerance"
                  value={targets}
                  onChange={(e) => setTargets(e.target.value)}
                />
              </div>
            </div>

            <button className="primary" type="submit">Run Gnome</button>
          </form>

          {/* Gnome Output Container */}
          {/* Gnome Output Container */}
{(gnomeOutput.loading || gnomeOutput.data || gnomeOutput.error) && (
  <div className="output">
    {gnomeOutput.loading && gnomeOutput.data?.length === 0 && "Running Gnome…"}
    {gnomeOutput.error && <p className="error-msg">{gnomeOutput.error}</p>}
    
    {gnomeOutput.data && gnomeOutput.data.length > 0 && (
      <>
        <h2>Discovered Materials ({gnomeOutput.data.length})</h2>
        <div className="materials-stream-list">
          {gnomeOutput.data.map((material, idx) => (
            <div key={material.id || idx} className="material-card" style={{ marginBottom: '1.5rem', borderBottom: '1px solid #334155', paddingBottom: '1rem' }}>
              <h3>System: {escapeHtml(material.formula)}</h3>
              <p><strong>MP ID:</strong> {escapeHtml(material.id)}</p>
              <p><strong>Band Gap:</strong> {material.bandGap} eV</p>
              
              <h4>Atomic Sites ({material.sites?.length || 0})</h4>
              <ul>
                {material.sites?.slice(0, 5).map((site, sIdx) => (
                  <li key={sIdx}>
                    Element: <strong>{escapeHtml(site.species)}</strong> — Coords: [{site.abc.map(n => n.toFixed(3)).join(', ')}]
                  </li>
                ))}
                {material.sites?.length > 5 && <li>...and {material.sites.length - 5} more sites</li>}
              </ul>
            </div>
          ))}
        </div>
      </>
    )}
  </div>
)}
        </section>

        {/* Section 2: Search Papers */}
        <section className="panel">
          <h2>2. Search academic papers</h2>
          <div className="search-row">
            <input
              id="paper-query"
              type="text"
              placeholder="Search: cellulose packaging, PHA composites, barrier films..."
              value={paperQuery}
              onChange={(e) => setPaperQuery(e.target.value)}
            />
            <button className="secondary" type="button" onClick={handlePaperSearch}>
              Search papers
            </button>
          </div>
          
          {/* Paper Results Area */}
          {(paperResults.loading || paperResults.data || paperResults.error) && (
            <div className="output">
              {paperResults.loading && "Searching papers…"}
              {paperResults.error && paperResults.error}
              {paperResults.data && paperResults.data.map((paper, idx) => (
                <div className="paper" key={idx}>
                  <h3>{escapeHtml(paper.title)}</h3>
                  <p>
                    {escapeHtml(paper.authors?.join(", "))} • {paper.year || "Year n/a"} • {escapeHtml(paper.venue || "Venue n/a")}
                  </p>
                  <p>Citations: {paper.citationCount ?? 0}</p>
                  <p>{escapeHtml(paper.abstract || "Abstract unavailable.")}</p>
                  <a href={escapeHtml(paper.url)} target="_blank" rel="noreferrer">View paper</a>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Section 3: 3D Visualization */}
        <section className="panel grid-2">
          <div>
            <h2>3. 3D material concept</h2>
            <p>
              Visual model representing a porous, fiber-reinforced composite.
              Adjust porosity to see how the internal structure changes.
            </p>
            <label htmlFor="porosity">Porosity</label>
            <input 
              id="porosity" 
              type="range" 
              min="0" 
              max="100" 
              value={porosity} 
              onChange={handlePorosityChange}
            />
            <div className="legend">
              <span>Dense</span>
              <span>Porous</span>
            </div>
          </div>
          <div className="canvas-wrap">
            <canvas ref={canvasRef} id="material-canvas" />
          </div>
        </section>

        {/* Section 4: High-level overview */}
        <section className="panel">
          <h2>4. High-level manufacturing overview</h2>
          <div className="output">
            {recipe.loading && "Loading recipe..."}
            {recipe.error && recipe.error}
            {recipe.data && (
              <>
                <h3>{escapeHtml(recipe.data.material)}</h3>
                <ul>
                  {recipe.data.steps.map((step, idx) => (
                    <li key={idx}>{escapeHtml(step)}</li>
                  ))}
                </ul>
                <p><strong>Compliance:</strong> {escapeHtml(recipe.data.compliance)}</p>
              </>
            )}
          </div>
        </section>
      </main>

      <footer>
        <p>Powered by a mock DeepMind Gnome integration + Semantic Scholar search.</p>
      </footer>
    </>
  );
}