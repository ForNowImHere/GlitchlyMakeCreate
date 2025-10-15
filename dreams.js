const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const fs = require('fs-extra');
const path = require('path');

const app = express();
const PORT = 3000;

// Paths
const PUBLIC_DIR = path.join(__dirname, 'public');
const USERS_FILE = path.join(__dirname, 'users.json');
const APPS_FILE = path.join(__dirname, 'apps.json');
const ANALYTICS_FILE = path.join(__dirname, 'analytics.json');

// Ensure folders & files exist
fs.ensureDirSync(PUBLIC_DIR);
if (!fs.existsSync(USERS_FILE)) fs.writeJSONSync(USERS_FILE, {});
if (!fs.existsSync(APPS_FILE)) fs.writeJSONSync(APPS_FILE, {});
if (!fs.existsSync(ANALYTICS_FILE)) fs.writeJSONSync(ANALYTICS_FILE, {});

// Middleware
app.use(express.static('frontend'));
app.use('/public', express.static(PUBLIC_DIR));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: 'glitchly-secret',
  resave: false,
  saveUninitialized: true,
}));

// Helper
async function isAdmin(user) {
  const users = await fs.readJSON(USERS_FILE);
  return users[user]?.role === 'admin';
}

app.get('/api/anl', async (req, res) => {
  try {
    const analytics = await fs.readJson(ANALYTICS_FILE);
    // Aggregate stats for all sites
    let totalSites = 0, views = 0, uniqueVisitors = 0, blockedSites = 0, pausedSites = 0;
    
    for (const site in analytics) {
      totalSites++;
      views += analytics[site].views || 0;
      uniqueVisitors += analytics[site].uniqueVisitors || 0;
      if (analytics[site].blocked) blockedSites++;
      if (analytics[site].paused) pausedSites++;
    }
    
    res.json({
      site: "All Sites",
      data: {
        totalSites,
        views,
        uniqueVisitors,
        blockedSites,
        pausedSites,
      }
    });
  } catch (err) {
    console.error('Failed to read analytics:', err);
    res.status(500).json({ error: 'Failed to load analytics data' });
  }
});

// 🌐 Home
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
        </style>
      </head>
      <body>
        <div class="container">
          <div class="gifbox">
            <img src="https://i.ibb.co/4BQ96Xq/Keenshowwaveadam.jpg" alt="Glitch">
          </div>
          <div>
            <h1>✨ Welcome to Glitchly ✨</h1>
            <p>⚠️ WEBPs are <strong style="color:red;">HATED</strong>. Use <strong style="color:lime">PNGs</strong> like the old gods intended.</p>
            <p>Create your app at <code>/edit/appname</code> or run it at <code>/appname</code>.</p>
            <h3>🧪 Recently Created Sites</h3>
            <ul>${recentSites || '<li>No sites yet.</li>'}</ul>
            <p><a href="/login">🔐 Login</a> | <a href="/signup">📝 Signup</a> | <a href="/anl">📊 Admin Analytics</a></p>
          </div>
        </div>
      </body>
    </html>
  `);
});

// 🔐 Signup
app.get('/signup', (req, res) => {
  res.send(`
    <form method="POST">
      <h2>Signup</h2>
      Username: <input name="username" /><br>
      Password: <input type="password" name="password" /><br>
      <button>Signup</button>
    </form>
  `);
});

app.post('/signup', async (req, res) => {
  const users = await fs.readJSON(USERS_FILE);
  const { username, password } = req.body;

  if (users[username]) return res.send("❌ Username taken.");

  const hashed = await bcrypt.hash(password, 10);
  const role = Object.keys(users).length === 0 ? 'admin' : 'user';
  users[username] = { password: hashed, role };
  await fs.writeJSON(USERS_FILE, users);

  req.session.user = username;
  res.redirect('/');
});

// 🔐 Login
app.get('/login', (req, res) => {
  res.send(`
    <form method="POST">
      <h2>Login</h2>
      Username: <input name="username" /><br>
      Password: <input type="password" name="password" /><br>
      <button>Login</button>
    </form>
  `);
});

app.post('/login', async (req, res) => {
  const users = await fs.readJSON(USERS_FILE);
  const { username, password } = req.body;

  if (!users[username] || !(await bcrypt.compare(password, users[username].password))) {
    return res.send("❌ Invalid login.");
  }

  req.session.user = username;
  res.redirect('/');
});

// 📝 Edit Page
app.get('/edit/:name', async (req, res) => {
  if (!req.session.user) return res.redirect('/login');

  const appName = req.params.name;
  const appDir = path.join(PUBLIC_DIR, appName);
  const indexFile = path.join(appDir, 'index.html');
  const apps = await fs.readJSON(APPS_FILE);
  const user = req.session.user;

  if (!apps[appName]) {
    apps[appName] = { owner: user, collaborators: [] };
    await fs.writeJSON(APPS_FILE, apps);
  } else {
    const appData = apps[appName];
    if (appData.owner !== user && !appData.collaborators.includes(user) && !(await isAdmin(user))) {
      return res.send("❌ You're not allowed to edit this app.");
    }
  }

  await fs.ensureDir(appDir);
  if (!(await fs.pathExists(indexFile))) {
    await fs.writeFile(indexFile, `<html><body><h1>Hello from ${appName}!</h1></body></html>`);
  }

  const html = await fs.readFile(indexFile, 'utf8');
  res.send(`
    <html style="background:#111;color:#eee;font-family:sans-serif">
      <body>
        <h2>Editing: ${appName}</h2>
        <form method="POST">
          <textarea name="code" style="width:100%;height:300px">${html.replace(/</g, "&lt;")}</textarea><br>
          <button type="submit">Save</button>
        </form>
        <form method="POST" action="/edit/${appName}/add-collab">
          <input name="collaborator" placeholder="Add collaborator" />
          <button>Add Collaborator</button>
        </form>
        <p><a href="/${appName}" style="color:lime">▶️ View App</a> | <a href="/${appName}/anl" style="color:cyan">📈 Analytics</a></p>
      </body>
    </html>
  `);
});

// 💾 Save Edits
app.post('/edit/:name', async (req, res) => {
  const user = req.session.user;
  const apps = await fs.readJSON(APPS_FILE);
  const appData = apps[req.params.name];

  if (!user || !appData || (appData.owner !== user && !appData.collaborators.includes(user) && !(await isAdmin(user)))) {
    return res.send("❌ You can't save this.");
  }

  const appDir = path.join(PUBLIC_DIR, req.params.name);
  const indexFile = path.join(appDir, 'index.html');
  await fs.writeFile(indexFile, req.body.code || '');
  res.redirect(`/edit/${req.params.name}`);
});

// ➕ Add Collaborator
app.post('/edit/:name/add-collab', async (req, res) => {
  const apps = await fs.readJSON(APPS_FILE);
  const app = apps[req.params.name];
  const user = req.session.user;
  const collab = req.body.collaborator;

  if (!app || app.owner !== user) return res.send("❌ Only the owner can add collaborators.");

  if (!app.collaborators.includes(collab)) {
    app.collaborators.push(collab);
    await fs.writeJSON(APPS_FILE, apps);
  }

  res.redirect(`/edit/${req.params.name}`);
});

// ▶️ Serve App + Track Views
app.get('/:name', async (req, res) => {
  const name = req.params.name;
  const indexFile = path.join(PUBLIC_DIR, name, 'index.html');

  if (!(await fs.pathExists(indexFile))) {
    return res.status(404).send("❌ App not found.");
  }

  const analytics = await fs.readJSON(ANALYTICS_FILE);
  if (!analytics[name]) analytics[name] = { views: 0 };
  analytics[name].views += 1;
  await fs.writeJSON(ANALYTICS_FILE, analytics);

  res.sendFile(indexFile);
});

// 📊 App Analytics
app.get('/:name/anl', async (req, res) => {
  const user = req.session.user;
  const name = req.params.name;
  const apps = await fs.readJSON(APPS_FILE);
  const app = apps[name];

  if (!app || (app.owner !== user && !app.collaborators.includes(user) && !(await isAdmin(user)))) {
    return res.send("❌ You can’t see this.");
  }

  const analytics = await fs.readJSON(ANALYTICS_FILE);
  const views = analytics[name]?.views || 0;

  res.send(`
    <html style="background:#111;color:#eee;font-family:sans-serif">
      <body>
        <h2>📈 Analytics for <code>${name}</code></h2>
        <p>👁️ Views: ${views}</p>
        <p><a href="/edit/${name}" style="color:lime">✏️ Back to Edit</a></p>
      </body>
    </html>
  `);
});

// 📊 All Analytics (Admins only)
app.get('/anl', async (req, res) => {
  const user = req.session.user;
  if (!user || !(await isAdmin(user))) return res.send("❌ Admins only.");

  const data = await fs.readJSON(ANALYTICS_FILE);
  const apps = Object.entries(data)
    .map(([app, d]) => `<li>${app}: ${d.views} views</li>`)
    .join('');

  res.send(`
    <html style="background:#111;color:#eee;font-family:sans-serif">
      <body>
        <h2>🌍 Global Glitchly Analytics</h2>
        <ul>${apps || '<li>No data yet</li>'}</ul>
        <p><a href="/">🏠 Back</a></p>
      </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log(`🌐 Glitchly running at http://localhost:${PORT}`);
});
