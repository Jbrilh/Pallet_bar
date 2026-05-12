const express  = require('express')
const crypto   = require('crypto')
const jwt      = require('jsonwebtoken')
const { bot }  = require('./bot')
const { supabase } = require('./db/client')

const SUPABASE_REF     = 'gzwxcdjvezevyvicamgc'
const DASHBOARD_ORIGIN = 'https://zingy-gumption-99ad2b.netlify.app'

const app = express()

// CORS — allow the Netlify dashboard to call /api/*
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin',  DASHBOARD_ORIGIN)
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.header('Access-Control-Allow-Headers', 'Content-Type')
    if (req.method === 'OPTIONS') return res.sendStatus(200)
    next()
})

// JSON body parser for all routes
app.use(express.json())

// Telegram webhook — explicit POST handler, compatible with Express 5
app.post(`/webhook/${process.env.BOT_TOKEN}`, async (req, res) => {
    const type = req.body?.message?.text || req.body?.callback_query?.data || JSON.stringify(Object.keys(req.body || {}))
    console.log(`📨 Webhook update received: ${type}`)
    try {
        await bot.handleUpdate(req.body)
        res.sendStatus(200)
    } catch (e) {
        console.error('Webhook handler error:', e.message)
        res.sendStatus(500)
    }
})

// Health check — visit in browser to confirm Railway URL is reachable
app.get('/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }))

// ── POST /api/auth ────────────────────────────────────────────
// Validates Telegram Login Widget data, returns a Supabase JWT
// scoped to the owner's bar_id so dashboard RLS policies work.
app.post('/api/auth', async (req, res) => {
    if (!validateTelegramAuth(req.body)) {
        return res.status(401).json({ error: 'Invalid Telegram auth data' })
    }

    const { data: bar, error } = await supabase
        .from('bars')
        .select('id, name, is_open, deep_link_code')
        .eq('owner_telegram_id', req.body.id)
        .eq('status', 'approved')
        .single()

    if (error || !bar) {
        return res.status(404).json({ error: 'No approved bar found for this account' })
    }

    if (!process.env.SUPABASE_JWT_SECRET) {
        // Fallback: no RLS, just return bar data without a scoped token
        return res.json({ token: null, bar })
    }

    const token = jwt.sign(
        {
            role: 'anon',
            iss:  'supabase',
            ref:  SUPABASE_REF,
            iat:  Math.floor(Date.now() / 1000),
            exp:  Math.floor(Date.now() / 1000) + 86400, // 24 h
            app_metadata: { bar_id: bar.id }
        },
        process.env.SUPABASE_JWT_SECRET
    )

    res.json({ token, bar })
})

// ── VALIDATE TELEGRAM WIDGET HASH ─────────────────────────────
function validateTelegramAuth(data) {
    const { hash, ...fields } = data
    if (!hash || !process.env.BOT_TOKEN) return false
    const checkStr = Object.keys(fields)
        .sort()
        .map(k => `${k}=${fields[k]}`)
        .join('\n')
    const secret = crypto.createHash('sha256').update(process.env.BOT_TOKEN).digest()
    const hmac   = crypto.createHmac('sha256', secret).update(checkStr).digest('hex')
    return hmac === hash
}

// ── START ──────────────────────────────────────────────────────
async function startServer() {
    const PORT = process.env.PORT || 3000

    app.listen(PORT, async () => {
        if (!process.env.WEBHOOK_URL) {
            console.warn('⚠️  WEBHOOK_URL not set — falling back to polling mode')
            bot.launch()
            return
        }
        const webhookUrl = `${process.env.WEBHOOK_URL}/webhook/${process.env.BOT_TOKEN}`
        try {
            await bot.telegram.setWebhook(webhookUrl)
            console.log(`🍻 Bot running on port ${PORT} | Webhook → ${webhookUrl}`)
        } catch (e) {
            console.error('Failed to set webhook:', e.message)
            console.log('Falling back to polling mode')
            bot.launch()
        }
    })
}

module.exports = { startServer }
