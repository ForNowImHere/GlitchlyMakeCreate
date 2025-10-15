const express = require('express');
const fs = require('fs-extra');
const path = require('path');

const app = express();
const PORT = 3000;

const PUBLIC_DIR = path.join(__dirname, 'public');
fs.ensureDirSync(PUBLIC_DIR);

app.use(express.static('frontend'));
app.use('/public', express.static(PUBLIC_DIR));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());



// 🏠 Home page with WebP hate
app.get('/', async (req, res) => {
  const files = await fs.readdir(PUBLIC_DIR);
  const recentSites = files
    .filter(name => fs.existsSync(path.join(PUBLIC_DIR, name, 'index.html')))
    .map(name => `<li><a href="/${name}" style="color:lime">${name}</a></li>`)
    .join('');

  res.send(`
    <html style="background:#111;color:#eee;font-family:sans-serif">
      <head>
        <style>
          body { margin: 0; display: flex; height: 100vh; align-items: center; justify-content: center; }
          .container { display: flex; gap: 2rem; align-items: center; max-width: 1000px; }
          .gifbox img { width: 250px; border: 3px solid #0f0; border-radius: 10px; }
          h1 { font-size: 3em; color: #0ff; animation: glow 2s ease-in-out infinite alternate; }
          @keyframes glow { from { text-shadow: 0 0 5px #0ff; } to { text-shadow: 0 0 20px #0ff; } }
          ul { padding-left: 1em; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="gifbox">
           <a href="https://imgbb.com/"><img src="https://i.ibb.co/4BQ96Xq/Keenshowwaveadam.jpg" alt="Keenshowwaveadam" border="0"></a>
          </div>
          <div>
            <h1>✨ Welcome to Glitchly ✨</h1>
            <p>⚠️ WEBPs are <strong style="color:red;">HATED</strong> around here. Use <strong style="color:lime">PNGs</strong> like the old gods intended.</p>
            <p>Create your app at <code>/edit/appname</code> or run it at <code>/appname</code>.</p>
            <h3>🧪 Recently Created Sites</h3>
            <ul>${recentSites || '<li>No sites yet. Be the first!</li>'}</ul>
          </div>
        </div>
        <script>
          const gif = document.getElementById('glitchy');
          gif.addEventListener('load', () => {
            setInterval(() => {
              gif.src = gif.src.split('?')[0] + '?' + new Date().getTime();
            }, 3000); // Restart every 3s to "glitch" loop
          });
        </script>
      </body>
    </html>
  `);
});

// 📝 Edit an app
app.get('/edit/:name', async (req, res) => {
  const appDir = path.join(PUBLIC_DIR, req.params.name);
  const indexFile = path.join(appDir, 'index.html');

  await fs.ensureDir(appDir);

  if (!(await fs.pathExists(indexFile))) {
    await fs.writeFile(indexFile, `<html><body><h1>Hello from ${req.params.name}!</h1></body></html>`);
  }

  const html = await fs.readFile(indexFile, 'utf8');

  res.send(`
    <html style="background:#111;color:#eee;font-family:sans-serif">
      <body>
        <h2>Editing: ${req.params.name}</h2>
        <form method="POST">
          <textarea name="code" style="width:100%;height:300px">${html.replace(/</g, "&lt;")}</textarea><br>
          <button type="submit">Save</button>
        </form>
        <p><a href="/${req.params.name}" style="color:lime">▶️ View App</a></p>
      </body>
    </html>
  `);
});

// 💾 Save the edited HTML
app.post('/edit/:name', async (req, res) => {
  const appDir = path.join(PUBLIC_DIR, req.params.name);
  const indexFile = path.join(appDir, 'index.html');
  const html = req.body.code || '';

  await fs.ensureDir(appDir);
  await fs.writeFile(indexFile, html);

  res.redirect(`/edit/${req.params.name}`);
});

// ▶️ Serve the app
app.get('/:name', async (req, res) => {
  const indexFile = path.join(PUBLIC_DIR, req.params.name, 'index.html');

  if (!(await fs.pathExists(indexFile))) {
    return res.status(404).send("❌ App not found.");
  }

  res.sendFile(indexFile);
});

app.listen(PORT, () => {
  console.log(`🌐 Glitchly running at http://localhost:${PORT}`);
});
