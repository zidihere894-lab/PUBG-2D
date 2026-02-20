// game.js - Complete Battle Royale Game Logic with Firebase

// ============================================
// GLOBAL VARIABLES
// ============================================

let currentUser = null;
let currentLobby = null;
let gameState = null;
let gameLoop = null;
let canvas = null;
let ctx = null;
let socket = null;
let players = [];
let loot = [];
let safeZone = {
    x: 500,
    y: 300,
    radius: 300,
    nextRadius: 200,
    shrinkTime: 0
};
let keys = {};
let mouse = { x: 0, y: 0, pressed: false };
let lastShot = 0;
let myPlayer = null;

// ============================================
// FIREBASE REFERENCES
// ============================================

const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();

// Collections
const usersCollection = db.collection('users');
const lobbiesCollection = db.collection('lobbies');
const friendsCollection = db.collection('friends');
const statsCollection = db.collection('stats');

// ============================================
// SCREEN MANAGEMENT
// ============================================

const screens = {
    loading: document.getElementById('loading-screen'),
    auth: document.getElementById('auth-screen'),
    menu: document.getElementById('menu-screen'),
    lobbyBrowser: document.getElementById('lobby-browser-screen'),
    createLobby: document.getElementById('create-lobby-screen'),
    lobbyRoom: document.getElementById('lobby-room-screen'),
    friends: document.getElementById('friends-screen'),
    game: document.getElementById('game-screen')
};

function showScreen(screenName) {
    Object.values(screens).forEach(screen => {
        screen.classList.remove('active');
    });
    screens[screenName].classList.add('active');
}

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
    setupEventListeners();
    updateLoadingProgress(30, 'Connecting to Firebase...');
});

function initializeApp() {
    // Check if user is already logged in
    auth.onAuthStateChanged(async (user) => {
        if (user) {
            // User is signed in
            currentUser = user;
            await loadUserData(user.uid);
            updateLoadingProgress(100, 'Welcome!');
            setTimeout(() => showScreen('menu'), 500);
        } else {
            // No user signed in
            updateLoadingProgress(100, 'Ready');
            setTimeout(() => showScreen('auth'), 500);
        }
    });
    
    // Initialize canvas for game
    canvas = document.getElementById('game-canvas');
    if (canvas) {
        ctx = canvas.getContext('2d', {
            alpha: false,
            antialias: true,
            powerPreference: "high-performance"
        });
        
        // Set canvas size for 120FPS optimization
        function resizeCanvas() {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        }
        
        window.addEventListener('resize', resizeCanvas);
        resizeCanvas();
    }
}

function updateLoadingProgress(progress, status) {
    document.getElementById('progress-fill').style.width = progress + '%';
    document.getElementById('connection-status').textContent = status;
}

// ============================================
// AUTHENTICATION
// ============================================

async function loadUserData(uid) {
    try {
        const userDoc = await usersCollection.doc(uid).get();
        
        if (!userDoc.exists) {
            // Create new user document
            await usersCollection.doc(uid).set({
                username: auth.currentUser.displayName || 'Player',
                email: auth.currentUser.email,
                avatar: auth.currentUser.photoURL || 'https://via.placeholder.com/100',
                level: 1,
                xp: 0,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        }
        
        // Load stats
        const statsDoc = await statsCollection.doc(uid).get();
        if (statsDoc.exists) {
            const stats = statsDoc.data();
            document.getElementById('stat-wins').textContent = stats.wins || 0;
            document.getElementById('stat-kills').textContent = stats.kills || 0;
            document.getElementById('stat-games').textContent = stats.games || 0;
        }
        
        // Update UI
        document.getElementById('user-name').textContent = 
            auth.currentUser.displayName || userDoc.data().username;
        document.getElementById('user-avatar').src = 
            auth.currentUser.photoURL || 'https://via.placeholder.com/100';
            
    } catch (error) {
        console.error('Error loading user data:', error);
    }
}

// Login with Email/Password
document.getElementById('login-btn').addEventListener('click', async () => {
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    
    try {
        await auth.signInWithEmailAndPassword(email, password);
    } catch (error) {
        showAuthError(error.message);
    }
});

// Register with Email/Password
document.getElementById('register-btn').addEventListener('click', async () => {
    const username = document.getElementById('register-username').value;
    const email = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;
    const confirm = document.getElementById('register-confirm').value;
    
    if (password !== confirm) {
        showAuthError('Passwords do not match');
        return;
    }
    
    try {
        const credential = await auth.createUserWithEmailAndPassword(email, password);
        
        // Update profile
        await credential.user.updateProfile({
            displayName: username
        });
        
        // Create user document
        await usersCollection.doc(credential.user.uid).set({
            username: username,
            email: email,
            level: 1,
            xp: 0,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        
    } catch (error) {
        showAuthError(error.message);
    }
});

// Google Login
document.getElementById('google-login-btn').addEventListener('click', async () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    
    try {
        await auth.signInWithPopup(provider);
    } catch (error) {
        showAuthError(error.message);
    }
});

// Logout
document.getElementById('logout-btn').addEventListener('click', async () => {
    try {
        await auth.signOut();
        showScreen('auth');
    } catch (error) {
        console.error('Logout error:', error);
    }
});

function showAuthError(message) {
    const errorDiv = document.getElementById('auth-error');
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
    setTimeout(() => {
        errorDiv.style.display = 'none';
    }, 3000);
}

// ============================================
// LOBBY MANAGEMENT
// ============================================

// Create Lobby
document.getElementById('confirm-create-lobby').addEventListener('click', async () => {
    const lobbyName = document.getElementById('lobby-name').value;
    const map = document.getElementById('map-select').value;
    const maxPlayers = parseInt(document.getElementById('max-players').value);
    const mode = document.getElementById('game-mode').value;
    const isPrivate = document.getElementById('private-lobby').checked;
    
    try {
        const lobbyData = {
            name: lobbyName,
            map: map,
            maxPlayers: maxPlayers,
            mode: mode,
            isPrivate: isPrivate,
            hostId: auth.currentUser.uid,
            hostName: auth.currentUser.displayName,
            players: [{
                id: auth.currentUser.uid,
                name: auth.currentUser.displayName,
                ready: false,
                team: 0,
                avatar: auth.currentUser.photoURL || 'https://via.placeholder.com/40'
            }],
            status: 'waiting',
            code: generateLobbyCode(),
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        
        const docRef = await lobbiesCollection.add(lobbyData);
        
        // Subscribe to lobby updates
        subscribeToLobby(docRef.id);
        
        showScreen('lobbyRoom');
        
    } catch (error) {
        console.error('Error creating lobby:', error);
    }
});

function generateLobbyCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// Load Lobbies
async function loadLobbies() {
    try {
        const snapshot = await lobbiesCollection
            .where('status', '==', 'waiting')
            .orderBy('createdAt', 'desc')
            .limit(20)
            .get();
        
        const lobbiesList = document.getElementById('lobbies-list');
        lobbiesList.innerHTML = '';
        
        snapshot.forEach(doc => {
            const lobby = doc.data();
            const lobbyElement = createLobbyElement(doc.id, lobby);
            lobbiesList.appendChild(lobbyElement);
        });
        
    } catch (error) {
        console.error('Error loading lobbies:', error);
    }
}

function createLobbyElement(id, lobby) {
    const div = document.createElement('div');
    div.className = 'lobby-item';
    div.innerHTML = `
        <div class="lobby-info">
            <h4>${lobby.name}</h4>
            <p>${lobby.players.length}/${lobby.maxPlayers} • ${lobby.map} • ${lobby.mode}</p>
        </div>
        <button class="lobby-join" data-id="${id}">JOIN</button>
    `;
    
    div.querySelector('.lobby-join').addEventListener('click', () => joinLobby(id));
    
    return div;
}

async function joinLobby(lobbyId) {
    try {
        const lobbyRef = lobbiesCollection.doc(lobbyId);
        const lobby = await lobbyRef.get();
        
        if (!lobby.exists) {
            alert('Lobby not found');
            return;
        }
        
        const lobbyData = lobby.data();
        
        if (lobbyData.players.length >= lobbyData.maxPlayers) {
            alert('Lobby is full');
            return;
        }
        
        // Add player to lobby
        await lobbyRef.update({
            players: firebase.firestore.FieldValue.arrayUnion({
                id: auth.currentUser.uid,
                name: auth.currentUser.displayName,
                ready: false,
                team: 0,
                avatar: auth.currentUser.photoURL || 'https://via.placeholder.com/40'
            })
        });
        
        // Subscribe to updates
        subscribeToLobby(lobbyId);
        
        showScreen('lobbyRoom');
        
    } catch (error) {
        console.error('Error joining lobby:', error);
    }
}

function subscribeToLobby(lobbyId) {
    lobbiesCollection.doc(lobbyId).onSnapshot((doc) => {
        if (doc.exists) {
            const lobby = doc.data();
            currentLobby = { id: doc.id, ...lobby };
            updateLobbyUI(lobby);
        }
    });
}

function updateLobbyUI(lobby) {
    document.getElementById('room-name').textContent = lobby.name;
    document.getElementById('room-code').textContent = lobby.code;
    document.getElementById('room-map').textContent = lobby.map;
    document.getElementById('room-mode').textContent = lobby.mode;
    
    // Update players
    const playersGrid = document.getElementById('room-players');
    playersGrid.innerHTML = '';
    
    lobby.players.forEach(player => {
        const playerCard = document.createElement('div');
        playerCard.className = `player-card ${player.id === lobby.hostId ? 'host' : ''}`;
        playerCard.innerHTML = `
            <img src="${player.avatar}" class="player-avatar">
            <div class="player-name">${player.name}</div>
            <div class="player-status ${player.ready ? 'ready' : ''}">
                ${player.ready ? '✓ READY' : '⏳ NOT READY'}
            </div>
            ${player.id === lobby.hostId ? '<div class="host-badge">HOST</div>' : ''}
        `;
        playersGrid.appendChild(playerCard);
    });
    
    // Update ready count
    const readyCount = lobby.players.filter(p => p.ready).length;
    document.getElementById('ready-count').textContent = 
        `${readyCount}/${lobby.players.length}`;
    
    // Enable/disable start button
    const startBtn = document.getElementById('start-game-btn');
    const allReady = lobby.players.every(p => p.ready) && 
                     lobby.players.length >= 2;
    
    if (lobby.hostId === auth.currentUser.uid) {
        startBtn.disabled = !allReady;
    } else {
        startBtn.disabled = true;
    }
}

// Ready button
document.getElementById('ready-button').addEventListener('click', async () => {
    if (!currentLobby) return;
    
    const player = currentLobby.players.find(p => p.id === auth.currentUser.uid);
    const newReady = !player.ready;
    
    await lobbiesCollection.doc(currentLobby.id).update({
        players: currentLobby.players.map(p => 
            p.id === auth.currentUser.uid ? { ...p, ready: newReady } : p
        )
    });
    
    document.getElementById('ready-button').textContent = 
        newReady ? 'READY ✓' : 'NOT READY';
    document.getElementById('ready-button').classList.toggle('ready', newReady);
});

// Start game
document.getElementById('start-game-btn').addEventListener('click', () => {
    if (currentLobby && currentLobby.hostId === auth.currentUser.uid) {
        startGame();
    }
});

// ============================================
// GAME LOGIC
// ============================================

function startGame() {
    showScreen('game');
    
    // Initialize game state
    gameState = {
        players: currentLobby.players.map(p => ({
            id: p.id,
            name: p.name,
            x: Math.random() * 800 + 100,
            y: Math.random() * 400 + 50,
            health: 100,
            armor: 0,
            weapons: ['pistol'],
            ammo: { pistol: 30 },
            kills: 0,
            isAlive: true
        })),
        safeZone: {
            x: 500,
            y: 300,
            radius: 300,
            nextRadius: 200,
            shrinkTime: Date.now() + 180000
        },
        loot: generateLoot(30),
        startedAt: Date.now()
    };
    
    // Find my player
    myPlayer = gameState.players.find(p => p.id === auth.currentUser.uid);
    
    // Start game loop
    if (gameLoop) cancelAnimationFrame(gameLoop);
    gameLoop = requestAnimationFrame(updateGame);
    
    // Show plane drop
    showPlaneDrop();
}

function generateLoot(count) {
    const loot = [];
    const items = [
        { type: 'weapon', name: 'pistol', ammo: 30 },
        { type: 'weapon', name: 'rifle', ammo: 60 },
        { type: 'weapon', name: 'shotgun', ammo: 20 },
        { type: 'armor', name: 'vest', defense: 50 },
        { type: 'armor', name: 'helmet', defense: 30 },
        { type: 'health', name: 'medkit', heal: 50 },
        { type: 'health', name: 'bandage', heal: 20 }
    ];
    
    for (let i = 0; i < count; i++) {
        const item = { ...items[Math.floor(Math.random() * items.length)] };
        item.id = `loot_${i}`;
        item.x = Math.random() * 1000;
        item.y = Math.random() * 600;
        loot.push(item);
    }
    
    return loot;
}

function showPlaneDrop() {
    const planeScreen = document.getElementById('plane-screen');
    planeScreen.style.display = 'flex';
    
    let timeLeft = 30;
    const timer = setInterval(() => {
        timeLeft--;
        document.getElementById('plane-timer').textContent = timeLeft;
        
        if (timeLeft <= 0) {
            clearInterval(timer);
            planeScreen.style.display = 'none';
        }
    }, 1000);
    
    document.getElementById('jump-btn').onclick = () => {
        clearInterval(timer);
        planeScreen.style.display = 'none';
    };
}

function updateGame() {
    if (!gameState) return;
    
    // Update safe zone
    const now = Date.now();
    if (now > gameState.safeZone.shrinkTime) {
        gameState.safeZone.radius = gameState.safeZone.nextRadius;
        gameState.safeZone.nextRadius = gameState.safeZone.radius * 0.6;
        gameState.safeZone.shrinkTime = now + 180000;
        
        // Move zone center towards random player
        const alivePlayers = gameState.players.filter(p => p.isAlive);
        if (alivePlayers.length > 0) {
            const target = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
            gameState.safeZone.x = target.x;
            gameState.safeZone.y = target.y;
        }
    }
    
    // Apply zone damage
    gameState.players.forEach(player => {
        if (!player.isAlive) return;
        
        const dx = player.x - gameState.safeZone.x;
        const dy = player.y - gameState.safeZone.y;
        const distance = Math.sqrt(dx*dx + dy*dy);
        
        if (distance > gameState.safeZone.radius) {
            player.health -= 0.5;
            if (player.health <= 0) {
                player.isAlive = false;
            }
        }
    });
    
    // Handle player input
    if (myPlayer && myPlayer.isAlive) {
        handleMovement();
        handleShooting();
        handleLootPickup();
    }
    
    // Check winner
    const alivePlayers = gameState.players.filter(p => p.isAlive);
    if (alivePlayers.length === 1) {
        showWinner(alivePlayers[0]);
    }
    
    // Update UI
    updateHUD();
    
    // Render game
    renderGame();
    
    // Continue loop
    gameLoop = requestAnimationFrame(updateGame);
}

function handleMovement() {
    if (!myPlayer) return;
    
    const speed = 3;
    let dx = 0, dy = 0;
    
    if (keys['w'] || keys['W'] || keys['ArrowUp']) dy -= speed;
    if (keys['s'] || keys['S'] || keys['ArrowDown']) dy += speed;
    if (keys['a'] || keys['A'] || keys['ArrowLeft']) dx -= speed;
    if (keys['d'] || keys['D'] || keys['ArrowRight']) dx += speed;
    
    // Normalize diagonal movement
    if (dx !== 0 && dy !== 0) {
        dx *= 0.707;
        dy *= 0.707;
    }
    
    myPlayer.x += dx;
    myPlayer.y += dy;
    
    // Keep in bounds
    myPlayer.x = Math.max(20, Math.min(980, myPlayer.x));
    myPlayer.y = Math.max(20, Math.min(580, myPlayer.y));
}

function handleShooting() {
    if (!myPlayer || !myPlayer.isAlive) return;
    
    const now = Date.now();
    const shootDelay = 200; // ms between shots
    
    if (mouse.pressed && now - lastShot > shootDelay) {
        lastShot = now;
        
        // Calculate bullet direction
        const dx = mouse.x - myPlayer.x;
        const dy = mouse.y - myPlayer.y;
        const distance = Math.sqrt(dx*dx + dy*dy);
        
        if (distance > 0) {
            const dirX = dx / distance;
            const dirY = dy / distance;
            
            // Check hits
            gameState.players.forEach(player => {
                if (player.id !== myPlayer.id && player.isAlive) {
                    const pdx = player.x - myPlayer.x;
                    const pdy = player.y - myPlayer.y;
                    const distToPlayer = Math.sqrt(pdx*pdx + pdy*pdy);
                    
                    // Simple hit detection
                    if (distToPlayer < 50 && Math.abs(pdx/dirX - pdy/dirY) < 20) {
                        player.health -= 20;
                        
                        if (player.health <= 0) {
                            player.isAlive = false;
                            myPlayer.kills++;
                            
                            // Add kill message
                            addKillMessage(myPlayer.name, player.name);
                        }
                    }
                }
            });
        }
    }
}

function handleLootPickup() {
    if (!myPlayer) return;
    
    // Check nearby loot
    gameState.loot.forEach((item, index) => {
        const dx = item.x - myPlayer.x;
        const dy = item.y - myPlayer.y;
        const distance = Math.sqrt(dx*dx + dy*dy);
        
        if (distance < 30) {
            document.getElementById('pickup-prompt').style.display = 'block';
            
            if (keys['f'] || keys['F']) {
                // Pickup item
                if (item.type === 'weapon') {
                    myPlayer.weapons.push(item.name);
                    myPlayer.ammo[item.name] = (myPlayer.ammo[item.name] || 0) + item.ammo;
                } else if (item.type === 'armor') {
                    myPlayer.armor = Math.max(myPlayer.armor, item.defense);
                } else if (item.type === 'health') {
                    myPlayer.health = Math.min(100, myPlayer.health + item.heal);
                }
                
                // Remove loot
                gameState.loot.splice(index, 1);
                document.getElementById('pickup-prompt').style.display = 'none';
            }
        } else {
            document.getElementById('pickup-prompt').style.display = 'none';
        }
    });
}

function addKillMessage(killer, victim) {
    const killFeed = document.getElementById('kill-feed');
    const message = document.createElement('div');
    message.className = 'kill-message';
    message.innerHTML = `
        <span class="killer">${killer}</span>
        <span class="weapon">🔫</span>
        <span>${victim}</span>
    `;
    
    killFeed.appendChild(message);
    
    // Remove after 3 seconds
    setTimeout(() => {
        message.remove();
    }, 3000);
}

function updateHUD() {
    if (!myPlayer) return;
    
    document.getElementById('health-fill').style.width = myPlayer.health + '%';
    document.getElementById('health-text').textContent = myPlayer.health;
    
    document.getElementById('armor-fill').style.width = myPlayer.armor + '%';
    document.getElementById('armor-text').textContent = myPlayer.armor;
    
    document.getElementById('kill-count').textContent = myPlayer.kills;
    
    const aliveCount = gameState.players.filter(p => p.isAlive).length;
    document.getElementById('alive-count').textContent = aliveCount;
    document.getElementById('total-count').textContent = gameState.players.length;
    
    // Update zone timer
    const timeLeft = Math.max(0, Math.floor((gameState.safeZone.shrinkTime - Date.now()) / 1000));
    const minutes = Math.floor(timeLeft / 60);
    const seconds = timeLeft % 60;
    document.getElementById('zone-timer').textContent = 
        `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function renderGame() {
    if (!ctx || !gameState) return;
    
    // Clear canvas
    ctx.fillStyle = '#1a472a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Draw grid (for depth)
    ctx.strokeStyle = '#2a5a3a';
    ctx.lineWidth = 1;
    for (let i = 0; i < canvas.width; i += 50) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, canvas.height);
        ctx.strokeStyle = '#2a5a3a20';
        ctx.stroke();
    }
    for (let i = 0; i < canvas.height; i += 50) {
        ctx.beginPath();
        ctx.moveTo(0, i);
        ctx.lineTo(canvas.width, i);
        ctx.stroke();
    }
    
    // Draw safe zone
    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(
        gameState.safeZone.x,
        gameState.safeZone.y,
        gameState.safeZone.radius,
        0,
        Math.PI * 2
    );
    ctx.stroke();
    
    // Draw loot
    gameState.loot.forEach(item => {
        ctx.fillStyle = item.type === 'weapon' ? '#ffaa00' : 
                        item.type === 'armor' ? '#00aaff' : '#ff5555';
        ctx.beginPath();
        ctx.arc(item.x, item.y, 8, 0, Math.PI * 2);
        ctx.fill();
        
        // Glow effect
        ctx.shadowColor = ctx.fillStyle;
        ctx.shadowBlur = 10;
        ctx.fill();
        ctx.shadowBlur = 0;
    });
    
    // Draw players
    gameState.players.forEach(player => {
        if (!player.isAlive) return;
        
        // Player color
        ctx.fillStyle = player.id === auth.currentUser.uid ? '#00ff00' : '#ff0000';
        
        // Draw player
        ctx.beginPath();
        ctx.arc(player.x, player.y, 15, 0, Math.PI * 2);
        ctx.fill();
        
        // Draw health bar
        ctx.fillStyle = '#ff0000';
        ctx.fillRect(player.x - 20, player.y - 25, 40, 5);
        ctx.fillStyle = '#00ff00';
        ctx.fillRect(player.x - 20, player.y - 25, 40 * (player.health/100), 5);
        
        // Draw name
        ctx.fillStyle = 'white';
        ctx.font = '12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(player.name, player.x, player.y - 35);
        
        // Draw weapon if shooting
        if (player.isShooting) {
            ctx.strokeStyle = '#ffff00';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(player.x, player.y);
            ctx.lineTo(player.x + player.shootDirX * 50, player.y + player.shootDirY * 50);
            ctx.stroke();
        }
    });
    
    // Update minimap
    updateMinimap();
}

function updateMinimap() {
    const minimap = document.getElementById('minimap-canvas');
    const miniCtx = minimap.getContext('2d');
    
    miniCtx.fillStyle = '#1a472a';
    miniCtx.fillRect(0, 0, 100, 100);
    
    // Draw safe zone on minimap
    miniCtx.strokeStyle = '#00ff00';
    miniCtx.lineWidth = 2;
    miniCtx.beginPath();
    miniCtx.arc(50, 50, 30, 0, Math.PI * 2);
    miniCtx.stroke();
    
    // Draw players on minimap
    gameState.players.forEach(player => {
        if (!player.isAlive) return;
        
        const x = (player.x / 1000) * 100;
        const y = (player.y / 600) * 100;
        
        miniCtx.fillStyle = player.id === auth.currentUser.uid ? '#00ff00' : '#ff0000';
        miniCtx.beginPath();
        miniCtx.arc(x, y, 3, 0, Math.PI * 2);
        miniCtx.fill();
    });
}

function showWinner(player) {
    document.getElementById('winner-screen').style.display = 'flex';
    document.getElementById('winner-name').textContent = player.name;
    document.getElementById('winner-kills').textContent = player.kills;
    
    // Save stats
    if (player.id === auth.currentUser.uid) {
        saveStats(player.kills, true);
    }
}

async function saveStats(kills, isWinner) {
    try {
        const statsRef = statsCollection.doc(auth.currentUser.uid);
        const stats = await statsRef.get();
        
        if (stats.exists) {
            await statsRef.update({
                games: firebase.firestore.FieldValue.increment(1),
                kills: firebase.firestore.FieldValue.increment(kills),
                wins: firebase.firestore.FieldValue.increment(isWinner ? 1 : 0)
            });
        } else {
            await statsRef.set({
                games: 1,
                kills: kills,
                wins: isWinner ? 1 : 0
            });
        }
    } catch (error) {
        console.error('Error saving stats:', error);
    }
}

// ============================================
// EVENT LISTENERS
// ============================================

function setupEventListeners() {
    // Tab switching
    document.querySelectorAll('.auth-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            document.querySelectorAll('.auth-form').forEach(form => form.classList.remove('active'));
            document.getElementById(tab.dataset.tab + '-form').classList.add('active');
        });
    });
    
    // Navigation
    document.getElementById('play-btn').addEventListener('click', () => {
        showScreen('lobbyBrowser');
        loadLobbies();
    });
    
    document.getElementById('lobby-btn').addEventListener('click', () => {
        showScreen('lobbyBrowser');
        loadLobbies();
    });
    
    document.getElementById('friends-btn').addEventListener('click', () => {
        showScreen('friends');
        loadFriends();
    });
    
    document.getElementById('create-lobby-btn').addEventListener('click', () => {
        showScreen('createLobby');
    });
    
    document.getElementById('back-to-menu').addEventListener('click', () => {
        showScreen('menu');
    });
    
    document.getElementById('back-to-browser').addEventListener('click', () => {
        showScreen('lobbyBrowser');
    });
    
    document.getElementById('back-to-menu-from-friends').addEventListener('click', () => {
        showScreen('menu');
    });
    
    document.getElementById('back-to-menu-from-game').addEventListener('click', () => {
        document.getElementById('winner-screen').style.display = 'none';
        showScreen('menu');
        if (gameLoop) {
            cancelAnimationFrame(gameLoop);
            gameLoop = null;
        }
    });
    
    document.getElementById('leave-lobby').addEventListener('click', async () => {
        if (currentLobby) {
            await lobbiesCollection.doc(currentLobby.id).update({
                players: currentLobby.players.filter(p => p.id !== auth.currentUser.uid)
            });
            showScreen('lobbyBrowser');
        }
    });
    
    document.getElementById('copy-code').addEventListener('click', () => {
        const code = document.getElementById('room-code').textContent;
        navigator.clipboard.writeText(code);
        alert('Lobby code copied!');
    });
    
    // Chat
    document.getElementById('send-chat').addEventListener('click', sendChatMessage);
    document.getElementById('chat-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendChatMessage();
    });
    
    // Keyboard controls
    window.addEventListener('keydown', (e) => {
        keys[e.key] = true;
    });
    
    window.addEventListener('keyup', (e) => {
        keys[e.key] = false;
    });
    
    // Mouse controls
    canvas.addEventListener('mousemove', (e) => {
        const rect = canvas.getBoundingClientRect();
        mouse.x = (e.clientX - rect.left) * (canvas.width / rect.width);
        mouse.y = (e.clientY - rect.top) * (canvas.height / rect.height);
    });
    
    canvas.addEventListener('mousedown', () => {
        mouse.pressed = true;
    });
    
    canvas.addEventListener('mouseup', () => {
        mouse.pressed = false;
    });
    
    canvas.addEventListener('mouseleave', () => {
        mouse.pressed = false;
    });
    
    // Touch controls for mobile
    canvas.addEventListener('touchmove', (e) => {
        e.preventDefault();
        const touch = e.touches[0];
        const rect = canvas.getBoundingClientRect();
        mouse.x = (touch.clientX - rect.left) * (canvas.width / rect.width);
        mouse.y = (touch.clientY - rect.top) * (canvas.height / rect.height);
    });
    
    canvas.addEventListener('touchstart', (e) => {
        e.preventDefault();
        mouse.pressed = true;
    });
    
    canvas.addEventListener('touchend', (e) => {
        e.preventDefault();
        mouse.pressed = false;
    });
}

function sendChatMessage() {
    const input = document.getElementById('chat-input');
    const message = input.value.trim();
    
    if (message && currentLobby) {
        const chatDiv = document.getElementById('chat-messages');
        const msgDiv = document.createElement('div');
        msgDiv.className = 'chat-message';
        msgDiv.innerHTML = `
            <span class="sender">${auth.currentUser.displayName}:</span>
            <span class="message">${message}</span>
        `;
        chatDiv.appendChild(msgDiv);
        chatDiv.scrollTop = chatDiv.scrollHeight;
        
        input.value = '';
    }
}

async function loadFriends() {
    // Load friends from Firestore
    const friendsList = document.getElementById('friends-list');
    friendsList.innerHTML = '<div class="loading-spinner"></div>';
    
    try {
        const snapshot = await friendsCollection
            .where('userId', '==', auth.currentUser.uid)
            .get();
        
        if (snapshot.empty) {
            friendsList.innerHTML = '<div class="empty-state">No friends yet</div>';
            return;
        }
        
        friendsList.innerHTML = '';
        snapshot.forEach(doc => {
            const friend = doc.data();
            const friendDiv = document.createElement('div');
            friendDiv.className = 'friend-item';
            friendDiv.innerHTML = `
                <img src="${friend.avatar}" class="friend-avatar">
                <span class="friend-name">${friend.name}</span>
                <span class="friend-status ${friend.online ? 'online' : 'offline'}">
                    ${friend.online ? '● Online' : '○ Offline'}
                </span>
            `;
            friendsList.appendChild(friendDiv);
        });
        
    } catch (error) {
        console.error('Error loading friends:', error);
        friendsList.innerHTML = '<div class="empty-state">Error loading friends</div>';
    }
}
