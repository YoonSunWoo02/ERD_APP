const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const stripe = process.env.STRIPE_SECRET_KEY ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null;

const app = express();

// 사용 횟수 추적 (임시 메모리 저장 — 나중에 DB로 교체)
// .env에 FREE_LIMIT=숫자 로 변경 가능 (기본 20회)
const usageMap = {};
const FREE_LIMIT = Math.max(1, parseInt(process.env.FREE_LIMIT, 10) || 20);
const sharedERDs = {};
const proUsers = {};

function checkUsageLimit(req, res, next) {
  const ip = req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || 'unknown';
  const userEmail = req.body?.userEmail;
  const isPro = userEmail && proUsers[userEmail];
  usageMap[ip] = usageMap[ip] ?? 0;

  if (isPro) return next();
  if (usageMap[ip] >= FREE_LIMIT) {
    console.log(`[제한] IP ${ip} - ${usageMap[ip]}회 사용 (한도 ${FREE_LIMIT}) → 429`);
    res.setHeader('X-Usage-Count', String(usageMap[ip]));
    res.setHeader('X-Usage-Limit', String(FREE_LIMIT));
    return res.status(429).json({
      error: 'FREE_LIMIT_REACHED',
      message: `무료 플랜은 월 ${FREE_LIMIT}회까지 사용 가능합니다. Pro로 업그레이드하세요.`,
      upgradeUrl: `${process.env.BASE_URL || 'http://localhost:5173'}/upgrade`
    });
  }
  usageMap[ip]++;
  console.log(`[사용] IP ${ip} - 현재 ${usageMap[ip]}회 (한도 ${FREE_LIMIT})`);
  next();
}

app.use(cors());

// Stripe 웹훅은 raw body 필요 (express.json() 전에 등록)
app.post('/api/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe 미설정' });
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const customerEmail = session.customer_email || session.customer_details?.email;
    if (customerEmail) {
      proUsers[customerEmail] = true;
      console.log(`✅ Pro 결제 완료: ${customerEmail}`);
    }
  }
  res.json({ received: true });
});

app.use(express.json());

// 루트 주소 (http://localhost:3000) 접속 시
app.get('/', (req, res) => {
  res.json({
    ok: true,
    name: 'ERD API 서버',
    message: 'API 서버가 실행 중입니다.',
    app: 'http://localhost:5173',
    endpoints: {
      'GET /': '이 메시지',
      'GET /api/usage': '서버 확인',
      'POST /api/usage': '사용 1회 차감 (위젯에서 호출)',
      'POST /api/share': '공유 링크 생성',
      'GET /api/share/:id': '공유 ERD 조회'
    }
  });
});

// 사용 1회 확인 (무료 전용 — 한도 없음)
app.post('/api/usage', (req, res) => {
  res.json({ ok: true, message: '사용 1회 차감됨' });
});

// 브라우저에서 주소로 열었을 때: GET /api/usage → 서버 동작 확인용
app.get('/api/usage', (req, res) => {
  res.json({
    ok: true,
    message: 'API  서버 실행 중입니다. 사용 횟수는 위젯에서 "JSON 붙여넣기 → 적용" 또는 "공유" 시 POST로만 차감됩니다.',
    hint: 'http://localhost:5173 에서 ERD 앱을 사용해 보세요.'
  });
});

// 개발용: 무료 사용 횟수 초기화 (브라우저에서 열면 현재 IP 횟수만 0으로)
app.get('/api/reset-usage', (req, res) => {
  const ip = req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || 'unknown';
  usageMap[ip] = 0;
  console.log(`[초기화] IP ${ip} 사용 횟수 0으로 리셋`);
  res.json({ ok: true, message: '사용 횟수가 초기화되었어요.' });
});

// ERD 저장 & 공유 링크 생성 (무료 전용 — 한도 없음)
app.post('/api/share', (req, res) => {
  const { erdData } = req.body;
  if (!erdData) return res.status(400).json({ error: 'erdData 필요' });
  const shareId = crypto.randomBytes(6).toString('hex');
  sharedERDs[shareId] = {
    data: erdData,
    createdAt: new Date().toISOString()
  };
  res.json({
    shareId,
    shareUrl: `${process.env.BASE_URL || 'http://localhost:5173'}/share/${shareId}`
  });
});

// 공유된 ERD 조회
app.get('/api/share/:shareId', (req, res) => {
  const erd = sharedERDs[req.params.shareId];
  if (!erd) return res.status(404).json({ error: '링크가 만료되었거나 존재하지 않습니다.' });
  res.json(erd);
});

// 구독 결제 세션 생성 (Stripe)
app.post('/api/create-checkout', async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe 미설정' });
  const { userEmail } = req.body;
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      customer_email: userEmail || undefined,
      line_items: [{ price: process.env.STRIPE_PRO_PRICE_ID, quantity: 1 }],
      success_url: `${process.env.BASE_URL || 'http://localhost:5173'}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.BASE_URL || 'http://localhost:5173'}/cancel`
    });
    res.json({ checkoutUrl: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`✅ API 서버 실행 중: http://localhost:${PORT}`);
  });
}

module.exports = app;
