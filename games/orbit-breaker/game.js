const canvas = document.querySelector('#board');
const ctx = canvas.getContext('2d');
const scoreNode = document.querySelector('#score');
const bestNode = document.querySelector('#best');
const livesNode = document.querySelector('#lives');
const statusNode = document.querySelector('#status');
const overlay = document.querySelector('#overlay');
const startButton = document.querySelector('#start-button');
const overlayIcon = document.querySelector('#overlay-icon');
const overlayKicker = document.querySelector('#overlay-kicker');
const overlayTitle = document.querySelector('#overlay-title');
const overlayCopy = document.querySelector('#overlay-copy');

const W = canvas.width;
const H = canvas.height;
const paddle = { x: W / 2, y: H - 38, w: 100, h: 10, speed: 7 };
const ball = { x: W / 2, y: paddle.y - 11, r: 7, dx: 3.2, dy: -4.1, attached: true };
const rows = 5;
const cols = 9;
const brick = { w: 62, h: 16, gap: 10, top: 62, left: (W - (cols * 62 + (cols - 1) * 10)) / 2 };
const colors = ['#fa8ec4', '#faad9b', '#ffd58a', '#9ef0be', '#7de8df'];
const keys = new Set();
let bricks = [];
let score = 0;
let lives = 3;
let running = false;
let animation;
let last = 0;
let best = Number(localStorage.getItem('orbit-breaker-best') || 0);

bestNode.textContent = String(best).padStart(4, '0');

function buildBricks() {
  bricks = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      bricks.push({ x: brick.left + col * (brick.w + brick.gap), y: brick.top + row * (brick.h + 11), w: brick.w, h: brick.h, color: colors[row], alive: true });
    }
  }
}

function drawBackground() {
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.strokeStyle = 'rgba(133, 159, 219, .055)';
  ctx.lineWidth = 1;
  for (let x = 24; x < W; x += 36) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 20; y < H; y += 36) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  ctx.restore();
}

function draw() {
  drawBackground();
  bricks.forEach((item) => {
    if (!item.alive) return;
    ctx.save();
    ctx.shadowColor = item.color;
    ctx.shadowBlur = 13;
    ctx.fillStyle = item.color;
    ctx.beginPath();
    ctx.roundRect(item.x, item.y, item.w, item.h, 4);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,.36)';
    ctx.fillRect(item.x + 7, item.y + 3, item.w - 14, 1);
  });

  ctx.save();
  ctx.shadowColor = '#7de8df';
  ctx.shadowBlur = 20;
  ctx.fillStyle = '#c5fff7';
  ctx.beginPath();
  ctx.roundRect(paddle.x - paddle.w / 2, paddle.y, paddle.w, paddle.h, 5);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.shadowColor = '#fff';
  ctx.shadowBlur = 22;
  const gradient = ctx.createRadialGradient(ball.x - 2, ball.y - 2, 1, ball.x, ball.y, ball.r + 2);
  gradient.addColorStop(0, '#fff');
  gradient.addColorStop(1, '#7de8df');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  if (ball.attached) {
    ctx.strokeStyle = 'rgba(125,232,223,.4)';
    ctx.setLineDash([3, 7]);
    ctx.beginPath();
    ctx.moveTo(ball.x, ball.y + 10);
    ctx.lineTo(ball.x, paddle.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function updateStats() {
  scoreNode.textContent = String(score).padStart(4, '0');
  livesNode.textContent = String(lives).padStart(2, '0');
  if (score > best) {
    best = score;
    bestNode.textContent = String(best).padStart(4, '0');
    localStorage.setItem('orbit-breaker-best', String(best));
  }
}

function showOverlay({ icon = '✦', kicker = 'READY WHEN YOU ARE', title = 'Find your<br>orbit.', copy = 'A tiny game for a tiny break.', button = 'Start playing' } = {}) {
  overlayIcon.textContent = icon;
  overlayKicker.textContent = kicker;
  overlayTitle.innerHTML = title;
  overlayCopy.textContent = copy;
  startButton.innerHTML = `${button} <span>↗</span>`;
  overlay.classList.remove('is-hidden');
}

function resetBall() {
  ball.attached = true;
  ball.x = paddle.x;
  ball.y = paddle.y - 11;
  ball.dx = (Math.random() > .5 ? 1 : -1) * 3.2;
  ball.dy = -4.1;
}

function finish(win) {
  running = false;
  cancelAnimationFrame(animation);
  statusNode.textContent = win ? 'FIELD CLEARED' : 'CORE AT REST';
  showOverlay(win
    ? { icon: '✧', kicker: 'FIELD CLEARED', title: 'Nice orbit.', copy: `You scored ${score} points. Go again?`, button: 'Play again' }
    : { icon: '◌', kicker: 'THE CORE WENT QUIET', title: 'Lost in<br>space.', copy: `Final score: ${score}. There is always another orbit.`, button: 'Try again' });
}

function moveBall() {
  if (keys.has('ArrowLeft')) paddle.x -= paddle.speed;
  if (keys.has('ArrowRight')) paddle.x += paddle.speed;
  paddle.x = Math.max(paddle.w / 2 + 8, Math.min(W - paddle.w / 2 - 8, paddle.x));
  if (ball.attached) {
    ball.x = paddle.x;
    ball.y = paddle.y - 11;
    return;
  }

  ball.x += ball.dx;
  ball.y += ball.dy;
  if (ball.x < ball.r || ball.x > W - ball.r) ball.dx *= -1;
  if (ball.y < ball.r) ball.dy = Math.abs(ball.dy);

  if (ball.dy > 0 && ball.y + ball.r >= paddle.y && ball.y - ball.r <= paddle.y + paddle.h && Math.abs(ball.x - paddle.x) <= paddle.w / 2 + ball.r) {
    const hit = (ball.x - paddle.x) / (paddle.w / 2);
    const speed = Math.min(7.4, Math.hypot(ball.dx, ball.dy) + .08);
    ball.dx = hit * speed * .88;
    ball.dy = -Math.sqrt(Math.max(4, speed ** 2 - ball.dx ** 2));
    ball.y = paddle.y - ball.r;
  }

  for (const item of bricks) {
    if (!item.alive) continue;
    if (ball.x + ball.r > item.x && ball.x - ball.r < item.x + item.w && ball.y + ball.r > item.y && ball.y - ball.r < item.y + item.h) {
      item.alive = false;
      ball.dy *= -1;
      score += (rows - Math.floor((item.y - brick.top) / (brick.h + 11))) * 10;
      updateStats();
      if (bricks.every((piece) => !piece.alive)) finish(true);
      break;
    }
  }

  if (ball.y > H + ball.r) {
    lives -= 1;
    updateStats();
    if (lives <= 0) finish(false);
    else resetBall();
  }
}

function frame(time) {
  if (!running) return;
  const delta = Math.min((time - last) / 16.67 || 1, 2);
  last = time;
  const count = Math.ceil(delta);
  for (let i = 0; i < count; i += 1) moveBall();
  draw();
  animation = requestAnimationFrame(frame);
}

function launch() {
  if (!running) return;
  ball.attached = false;
  statusNode.textContent = 'CORE IN MOTION';
}

function start() {
  score = 0;
  lives = 3;
  paddle.x = W / 2;
  buildBricks();
  resetBall();
  updateStats();
  running = true;
  last = performance.now();
  statusNode.textContent = 'CORE AT REST';
  overlay.classList.add('is-hidden');
  cancelAnimationFrame(animation);
  animation = requestAnimationFrame(frame);
}

startButton.addEventListener('click', start);
canvas.addEventListener('pointermove', (event) => {
  const bounds = canvas.getBoundingClientRect();
  const scaleX = W / bounds.width;
  paddle.x = Math.max(paddle.w / 2 + 8, Math.min(W - paddle.w / 2 - 8, (event.clientX - bounds.left) * scaleX));
  if (ball.attached) { ball.x = paddle.x; draw(); }
});
canvas.addEventListener('pointerdown', launch);
window.addEventListener('keydown', (event) => {
  if (['ArrowLeft', 'ArrowRight', ' '].includes(event.key)) event.preventDefault();
  keys.add(event.key);
  if (event.key === ' ' && running) launch();
  if (event.key.toLowerCase() === 'p' && running) {
    running = false;
    cancelAnimationFrame(animation);
    statusNode.textContent = 'PAUSED';
    showOverlay({ icon: 'Ⅱ', kicker: 'TAKE YOUR TIME', title: 'On pause.', copy: 'Your orbit will be right here.', button: 'Keep playing' });
  } else if (event.key.toLowerCase() === 'p' && !running && overlayKicker.textContent === 'TAKE YOUR TIME') {
    running = true;
    last = performance.now();
    statusNode.textContent = ball.attached ? 'CORE AT REST' : 'CORE IN MOTION';
    overlay.classList.add('is-hidden');
    animation = requestAnimationFrame(frame);
  }
});
window.addEventListener('keyup', (event) => keys.delete(event.key));
window.addEventListener('blur', () => keys.clear());

buildBricks();
draw();
