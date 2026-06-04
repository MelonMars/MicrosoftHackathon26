const gnomeForm = document.getElementById("gnome-form");
const gnomeOutput = document.getElementById("gnome-output");
const paperSearchButton = document.getElementById("paper-search");
const paperResults = document.getElementById("paper-results");
const recipeOutput = document.getElementById("recipe");

const escapeHtml = (value) =>
  (value || "")
    .toString()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const renderList = (items) =>
  `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;

gnomeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const problem = document.getElementById("problem").value.trim();
  const constraints = document.getElementById("constraints").value.trim();
  const targetProperties = document.getElementById("targets").value.trim();

  gnomeOutput.classList.remove("hidden");
  gnomeOutput.textContent = "Running Gnome…";

  try {
    const response = await fetch("/api/gnome", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ problem, constraints, targetProperties }),
    });

    if (!response.ok) {
      throw new Error("Gnome request failed.");
    }

    const data = await response.json();
    gnomeOutput.innerHTML = `
      <h3>Material system</h3>
      <p>${escapeHtml(data.materialSystem)}</p>
      <h3>Design proposal</h3>
      ${renderList(data.proposal)}
      <h3>Testing plan</h3>
      ${renderList(data.testingPlan)}
      <h3>Manufacturing overview</h3>
      ${renderList(data.manufacturingOverview)}
      <p><strong>Note:</strong> ${escapeHtml(data.safetyNotes)}</p>
    `;
  } catch (error) {
    gnomeOutput.textContent = "Unable to reach Gnome right now.";
  }
});

paperSearchButton.addEventListener("click", async () => {
  const query = document.getElementById("paper-query").value.trim();
  if (!query) {
    paperResults.classList.remove("hidden");
    paperResults.textContent = "Enter a search term to find papers.";
    return;
  }

  paperResults.classList.remove("hidden");
  paperResults.textContent = "Searching papers…";

  try {
    const response = await fetch(`/api/papers?query=${encodeURIComponent(query)}`);
    if (!response.ok) {
      throw new Error("Paper search failed.");
    }
    const data = await response.json();
    if (!data.papers?.length) {
      paperResults.textContent = "No papers found. Try another query.";
      return;
    }

    paperResults.innerHTML = data.papers
      .map(
        (paper) => `
        <div class="paper">
          <h3>${escapeHtml(paper.title)}</h3>
          <p>${escapeHtml(paper.authors.join(", "))} • ${
          paper.year || "Year n/a"
        } • ${escapeHtml(paper.venue || "Venue n/a")}</p>
          <p>Citations: ${paper.citationCount ?? 0}</p>
          <p>${escapeHtml(paper.abstract || "Abstract unavailable.")}</p>
          <a href="${escapeHtml(paper.url)}" target="_blank" rel="noreferrer">View paper</a>
        </div>
      `
      )
      .join("");
  } catch (error) {
    paperResults.textContent = "Paper search is unavailable right now.";
  }
});

const loadRecipe = async () => {
  try {
    const response = await fetch("/api/recipe");
    const data = await response.json();
    recipeOutput.innerHTML = `
      <h3>${escapeHtml(data.material)}</h3>
      ${renderList(data.steps)}
      <p><strong>Compliance:</strong> ${escapeHtml(data.compliance)}</p>
    `;
  } catch (error) {
    recipeOutput.textContent = "Recipe unavailable.";
  }
};

loadRecipe();

const canvas = document.getElementById("material-canvas");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0f172a);
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
camera.position.set(4, 3.5, 5);

const ambient = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambient);
const keyLight = new THREE.DirectionalLight(0xffffff, 0.8);
keyLight.position.set(3, 4, 5);
scene.add(keyLight);

const group = new THREE.Group();
const spheres = [];
const geometry = new THREE.SphereGeometry(0.35, 24, 24);
const material = new THREE.MeshStandardMaterial({
  color: 0x7aa2ff,
  roughness: 0.4,
  metalness: 0.1,
});

for (let x = -1; x <= 1; x += 1) {
  for (let y = -1; y <= 1; y += 1) {
    for (let z = -1; z <= 1; z += 1) {
      const sphere = new THREE.Mesh(geometry, material);
      sphere.position.set(x, y, z);
      group.add(sphere);
      spheres.push(sphere);
    }
  }
}

scene.add(group);

const resize = () => {
  const { clientWidth, clientHeight } = canvas.parentElement;
  renderer.setSize(clientWidth, clientHeight, false);
  camera.aspect = clientWidth / clientHeight;
  camera.updateProjectionMatrix();
};

const updatePorosity = (value) => {
  const total = spheres.length;
  const visibleCount = Math.max(4, Math.round(total * (1 - value / 100)));
  spheres.forEach((sphere, index) => {
    sphere.visible = index < visibleCount;
  });
};

const porosityInput = document.getElementById("porosity");
porosityInput.addEventListener("input", (event) => {
  updatePorosity(Number(event.target.value));
});
updatePorosity(Number(porosityInput.value));

const animate = () => {
  group.rotation.y += 0.004;
  group.rotation.x += 0.002;
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
};

resize();
window.addEventListener("resize", resize);
animate();
