# PrivacyScan Backend API
### Node.js / Express · SQLite/PostgreSQL (Prisma) · Paystack

Paystack handles **all payment methods** in one checkout:
- 💚 M-Pesa (Kenya)
- 🔴 Airtel Money
- 💳 Visa / Mastercard
- 🏦 Bank Transfer
- 📱 USSD

No M-Pesa Daraja API needed. Paystack routes automatically.

---

## Quick Start (5 minutes)

```bash
# 1. Install
npm install

# 2. Configure
cp .env.example .env
# Edit .env — add your Paystack keys

# 3. Set up database
npx prisma generate
npx prisma migrate dev --name init
node prisma/seed.js

# 4. Run
npm run dev       # development
npm start         # production
```

---

## Project Structure

```
privacyscan-backend/
├── src/
│   ├── index.js                    ← Express server
│   ├── middleware/index.js         ← CORS, rate limits, logging
│   ├── routes/
│   │   ├── payments.js             ← Paystack endpoints
│   │   ├── credits.js              ← Scan credit management
│   │   ├── affiliates.js           ← Affiliate program
│   │   ├── packages.js             ← Package listing
│   │   ├── scans.js                ← Analytics logging
│   │   └── admin.js                ← Admin dashboard
│   ├── controllers/
│   │   └── paymentController.js    ← All payment logic
│   └── services/
│       ├── paystack.js             ← Paystack API wrapper
│       ├── credits.js              ← Issue/consume credits
│       └── affiliate.js            ← 60% commission engine
├── prisma/
│   ├── schema.prisma               ← Database models
│   └── seed.js                     ← Package seed data
└── .env.example
```

---

## API Reference

**Base URL:** `https://YOUR-URL.railway.app/privacyscan`

### Packages
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/packages` | List all active packages |

### Payments
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/payments/initiate` | Start Paystack checkout |
| GET | `/payments/verify/:reference` | Verify + issue credits |
| POST | `/payments/webhook` | Paystack webhook receiver |
| GET | `/payments/callback` | Browser redirect after payment |

### Credits
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/credits/:deviceId` | Get active credits |
| POST | `/credits/:deviceId/consume` | Use one scan credit |

### Affiliates
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/affiliates/apply` | Apply to program |
| GET | `/affiliates/validate/:code` | Check referral code |
| GET | `/affiliates/stats/:code` | Earnings dashboard |

### Admin (requires `x-admin-key` header)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/admin/stats` | Revenue + scan overview |
| GET | `/admin/transactions` | All transactions |
| GET | `/admin/affiliates` | All affiliates |
| POST | `/admin/affiliates/:id/approve` | Approve affiliate |
| POST | `/admin/affiliates/:id/suspend` | Suspend affiliate |
| POST | `/admin/credits/grant` | Grant free credits |
| PATCH | `/admin/packages/:id` | Update pricing |

---

## Deploy to Railway

### Step 1 — Push to GitHub
```bash
git init
git add .
git commit -m "PrivacyScan backend"
git remote add origin https://github.com/YOU/privacyscan-backend.git
git push -u origin main
```

### Step 2 — Create Railway project
1. Go to [railway.app](https://railway.app) → New Project
2. Deploy from GitHub → select your repo
3. Railway auto-detects Node.js

### Step 3 — Add environment variables
In Railway dashboard → your service → Variables:

```
PORT                    = 3000
NODE_ENV                = production
API_BASE_URL            = https://YOUR-RAILWAY-URL.railway.app/privacyscan
DATABASE_URL            = file:./prisma/privacyscan.db
PAYSTACK_SECRET_KEY     = sk_live_xxxx
PAYSTACK_PUBLIC_KEY     = pk_live_xxxx
PAYSTACK_WEBHOOK_SECRET = whsec_xxxx
API_SECRET              = your_64_char_random_hex
AFFILIATE_COMMISSION_RATE = 0.60
```

### Step 4 — Register Paystack webhook
1. Go to [dashboard.paystack.com](https://dashboard.paystack.com)
2. Settings → Webhooks → Add webhook URL:
   ```
   https://YOUR-RAILWAY-URL.railway.app/privacyscan/payments/webhook
   ```
3. Copy the webhook secret → add to Railway env vars

### Step 5 — Update your React Native app
In `src/services/payment.js`:
```js
const BACKEND_URL = 'https://YOUR-RAILWAY-URL.railway.app/privacyscan';
```

---

## Paystack Setup (5 minutes)

1. Sign up at [paystack.com](https://paystack.com)
2. Complete business verification (needed for live keys)
3. Settings → API Keys → copy both keys
4. Settings → Webhooks → add your Railway URL
5. Paystack automatically enables M-Pesa for KE accounts,
   Airtel Money for UG/TZ, mobile money for GH, cards everywhere

**For Kenya M-Pesa specifically:**
- Your Paystack account must be registered as a Kenyan business
- Contact Paystack support to enable M-Pesa on your account

---

## How Commission Works

```
User pays KES 999 (Weekend Pass)
        ↓
Paystack webhook fires → charge.success
        ↓
Backend verifies → issues 5 scan credits to device
        ↓
Affiliate commission: KES 999 × 60% = KES 599
        ↓
affiliate.pendingBalance += 599
        ↓
Admin pays out → affiliate.totalPaid += 599
```

---

## Admin Access

```bash
# Get dashboard stats
curl -H "x-admin-key: YOUR_API_SECRET" \
  https://YOUR-URL.railway.app/privacyscan/admin/stats

# Approve an affiliate
curl -X POST \
  -H "x-admin-key: YOUR_API_SECRET" \
  https://YOUR-URL.railway.app/privacyscan/admin/affiliates/AFFILIATE_ID/approve
```

---

## Scale to PostgreSQL Later

When you have thousands of users, swap SQLite for PostgreSQL:

1. Add Railway PostgreSQL plugin (free to start)
2. In `prisma/schema.prisma` change `provider = "sqlite"` to `"postgresql"`
3. Update `DATABASE_URL` to your PostgreSQL connection string
4. Run `npx prisma migrate deploy`

---

Built by Pesagate Ltd · pesagate.com
