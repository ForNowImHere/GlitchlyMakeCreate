const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const fs = require('fs-extra');
const path = require('path');
const multer = require('multer');

// ---- Constants / File Paths ----
const app = express();
const PORT = 5000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const USERS_FILE = path.join(__dirname, 'users.json');
const APPS_FILE = path.join(__dirname, 'apps.json');
const ANALYTICS_FILE = path.join(__dirname, 'analytics.json');
const LIKES_FILE = path.join(__dirname, 'likes.json');
const SUBS_FILE = path.join(__dirname, 'subs.json');
const USER_LIKES_FILE = path.join(__dirname, 'user-likes.json');
const USER_SUBS_FILE = path.join(__dirname, 'user-subs.json');
const vidaUploadsDir = path.join(PUBLIC_DIR, 'vida', 'uploads');

// ---- Ensure folders & files exist ----
fs.ensureDirSync(PUBLIC_DIR);
fs.ensureDirSync(vidaUploadsDir);

for (const file of [USERS_FILE, APPS_FILE, ANALYTICS_FILE, LIKES_FILE, SUBS_FILE, USER_LIKES_FILE, USER_SUBS_FILE]) {
  if (!fs.existsSync(file)) fs.writeJSONSync(file, {});
}

// ---- Middleware ----
app.use(express.static('frontend'));
app.use('/public', express.static(PUBLIC_DIR));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: 'glitchly-secret',
  resave: false,
  saveUninitialized: true,
}));

// ---- Multer Setup ----
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, vidaUploadsDir),
  filename: (req, file, cb) => {
    const name = file.originalname.replace(/\.[^/.]+$/, '') + '.fastlie';
    cb(null, name);
  }
});
const upload = multer({ storage });

// == Video Features/DB in-memory for upload mechanic ==
let videosDB = {}; 
// { "videoName.fastlie": { owner: "userId" | null, claimed: false } }

// ---- Helper Middleware to Simulate Auth for Some Routes ----
function requireLogin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Login required' });
  next();
}

async function isAdmin(user) {
  const users = await fs.readJSON(USERS_FILE);
  return users[user]?.role === 'admin';
}

// ---- VIDEO UPLOAD ROUTES ----

// Upload route (API, with video tracking in videosDB)
app.post('/vida/upload', upload.single('video'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const name = req.file.filename;
  const owner = req.session.user ? req.session.user : null;
  videosDB[name] = { owner, claimed: !!owner };
  res.json({ success: true, name });
});

// Claim route
app.post('/vida/claim', requireLogin, (req, res) => {
  const { name } = req.body;
  if (!videosDB[name]) return res.status(404).json({ error: 'Video not found' });
  if (videosDB[name].claimed) return res.status(400).json({ error: 'Already claimed' });
  videosDB[name].owner = req.session.user;
  videosDB[name].claimed = true;
  res.json({ success: true, message: 'Video claimed!' });
});

// Rename route
app.post('/vida/rename', requireLogin, (req, res) => {
  const { oldName, newName } = req.body;
  if (!oldName || !newName) return res.status(400).json({ error: 'Missing names' });
  if (!videosDB[oldName]) return res.status(404).json({ error: 'Video not found' });
  const video = videosDB[oldName];
  if (video.owner && video.owner !== req.session.user) return res.status(403).json({ error: 'Not allowed to rename' });

  const oldPath = path.join(vidaUploadsDir, oldName);
  const newFileName = newName.replace(/\.[^/.]+$/, '') + '.fastlie';
  const newPath = path.join(vidaUploadsDir, newFileName);
  fs.rename(oldPath, newPath, err => {
    if (err) return res.status(500).json({ error: 'Rename failed' });
    videosDB[newFileName] = { owner: req.session.user, claimed: true };
    delete videosDB[oldName];
    res.json({ success: true, name: newFileName });
  });
});

// List videos (API, list all in DB)
app.get('/vida/videos', (req, res) => {
  res.json(Object.keys(videosDB));
});

// API: List Vida uploads from disk
app.get('/vida/api/videos', async (req, res) => {
  try {
    const files = await fs.readdir(vidaUploadsDir);
    res.json(files);
  } catch (e) {
    res.status(500).json({ error: 'Failed to list videos' });
  }
});

// ---- Static serving for uploads ----
app.use('/vida/uploads', express.static(vidaUploadsDir));

// ==== Video features: likes & subs (account-aware, atomic toggle) ====

// Like toggle (user must be logged in)
app.post('/vida/api/likes/:video', requireLogin, async (req, res) => {
  const username = req.session.user;
  const video = req.params.video;

  let allLikes = await fs.readJSON(LIKES_FILE);
  let userLikes = await fs.readJSON(USER_LIKES_FILE);
  allLikes[video] = allLikes[video] || 0;
  userLikes[username] = userLikes[username] || [];

  const liked = userLikes[username].includes(video);
  if (liked) {
    allLikes[video] = Math.max(0, allLikes[video] - 1);
    userLikes[username] = userLikes[username].filter(v => v !== video);
  } else {
    allLikes[video] += 1;
    userLikes[username].push(video);
  }
  await fs.writeJSON(LIKES_FILE, allLikes);
  await fs.writeJSON(USER_LIKES_FILE, userLikes);
  res.json({ likes: allLikes[video] });
});

// Get like count
app.get('/vida/api/likes/:video', async (req, res) => {
  const likes = await fs.readJSON(LIKES_FILE);
  res.json({ likes: likes[req.params.video] || 0 });
});

// Like check: did user like?
app.get('/vida/api/likes/:video/check', requireLogin, async (req, res) => {
  const username = req.session.user;
  const video = req.params.video;
  const userLikes = await fs.readJSON(USER_LIKES_FILE);
  const liked = userLikes[username]?.includes(video) || false;
  res.json({ liked });
});

// Subscribe toggle (user must be logged in)
app.post('/vida/api/subs/:channel', requireLogin, async (req, res) => {
  const username = req.session.user;
  const channel = req.params.channel;

  let allSubs = await fs.readJSON(SUBS_FILE);
  let userSubs = await fs.readJSON(USER_SUBS_FILE);
  allSubs[channel] = allSubs[channel] || 0;
  userSubs[username] = userSubs[username] || [];

  const subscribed = userSubs[username].includes(channel);
  if (subscribed) {
    allSubs[channel] = Math.max(0, allSubs[channel] - 1);
    userSubs[username] = userSubs[username].filter(c => c !== channel);
  } else {
    allSubs[channel] += 1;
    userSubs[username].push(channel);
  }
  await fs.writeJSON(SUBS_FILE, allSubs);
  await fs.writeJSON(USER_SUBS_FILE, userSubs);
  res.json({ subs: allSubs[channel] });
});

// Get sub count
app.get('/vida/api/subs/:user', async (req, res) => {
  const subs = await fs.readJSON(SUBS_FILE);
  res.json({ subs: subs[req.params.user] || 0 });
});

// Subscribed check: did user subscribe?
app.get('/vida/api/subs/:channel/check', requireLogin, async (req, res) => {
  const username = req.session.user;
  const channel = req.params.channel;
  const userSubs = await fs.readJSON(USER_SUBS_FILE);
  const subscribed = userSubs[username]?.includes(channel) || false;
  res.json({ subscribed });
});

// Logout (account)
app.post('/vida/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// Get user uploaded videos (profile)
app.get('/vida/api/account/uploads', requireLogin, async (req, res) => {
  const files = await fs.readdir(vidaUploadsDir);
  const uploads = files.filter(name => name.startsWith(req.session.user + '_'));
  res.json({ uploads });
});

// Get user subs (for recommendations)
app.get('/vida/api/account/subs', requireLogin, async (req, res) => {
  const userSubs = await fs.readJSON(USER_SUBS_FILE);
  res.json({ subs: userSubs[req.session.user] || [] });
});

// ---- Analytics API ----
app.get('/api/anl', async (req, res) => {
  try {
    const analytics = await fs.readJson(ANALYTICS_FILE);
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
    res.status(500).json({ error: 'Failed to load analytics data' });
  }
});

// ---- Home Page ----
app.get('/', async (req, res) => {
  const files = await fs.readdir(PUBLIC_DIR);
  const recentSites = files
    .filter(name => fs.existsSync(path.join(PUBLIC_DIR, name, 'index.html')))
    .map(name => `<li><a href="/${name}" style="color:lime">${name}</a></li>`)
    .join('');
  res.send(`
  <html lang="en" style="margin:0; padding:0; background:#0a0a0a; color:#eee; font-family:'Segoe UI', sans-serif;">
    <head>
      <meta charset="UTF-8">
      <title>Glitchly</title>
      <style>
        /* ...Your CSS, omitted for brevity... */
      </style>
    </head>
    <body>
      <div class="bg-glow"></div>
      <div class="container">
        <div class="gifbox">
          <img src="https://i.ibb.co/4BQ96Xq/Keenshowwaveadam.jpg" alt="Glitch">
        </div>
        <div>
          <h1>✨ Welcome to Glitchly ✨</h1>
          <p>⚠️ WEBPs are <span class="warning">HATED</span>. Use <span class="praise">PNGs</span> like the old gods intended.</p>
          <p>Create your app at <code>/edit/appname</code> or run it at <code>/appname</code>.</p>
          <h3>🧪 Recently Created Sites</h3>
          <ul>${recentSites || '<li>No sites yet.</li>'}</ul>
          <p>
            <a href="/login">🔐 Login</a> | 
            <a href="/signup">📝 Signup</a> | 
            <a href="/anl">📊 Admin Analytics</a>
          </p>
        </div>
      </div>
    </body>
  </html>
  `);
});

// ---- Signup/Login ----
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

// ---- App Editor ----
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

// ---- App Serving and Analytics ----
app.get('/:name', async (req, res) => {
  const name = req.params.name;
  const indexFile = path.join(PUBLIC_DIR, name, 'index.html');
  if (!(await fs.pathExists(indexFile))) return res.status(404).send("❌ App not found.");
  const analytics = await fs.readJSON(ANALYTICS_FILE);
  if (!analytics[name]) analytics[name] = { views: 0 };
  analytics[name].views += 1;
  await fs.writeJSON(ANALYTICS_FILE, analytics);
  res.sendFile(indexFile);
});

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

// ---- Start Server ----
app.listen(PORT, () => {
  console.log(`🌐 Glitchly running at http://localhost:${PORT}`);
});
