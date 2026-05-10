require('dotenv').config()

const { Telegraf, Markup, session } = require('telegraf')
const fs = require('fs')
const path = require('path')
const { createClient } = require('@supabase/supabase-js')

// --------------------
// BOT + SUPABASE INIT
// --------------------
const bot = new Telegraf(process.env.BOT_TOKEN)
const supabase = createClient(
    'https://gzwxcdjvezevyvicamgc.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd6d3hjZGp2ZXpldnl2aWNhbWdjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzOTgxMzYsImV4cCI6MjA5Mzk3NDEzNn0.-jQhDC2o6Pbb-Nk8Byhs2lMzGks637KwH-6NXsb2Ujg'
)

// --------------------
// STAFF GROUP IDs
// --------------------
const BARTENDER_GROUP_ID  = -5098569760
const WAITRESS_1_GROUP_ID = -5253381539
const WAITRESS_2_GROUP_ID = -5257042379
const OWNER_GROUP_ID      = -5040789601

// --------------------
// MENU
// --------------------
function loadMenu() {
    const raw = fs.readFileSync(path.join(__dirname, 'menu.json'), 'utf8')
    return JSON.parse(raw)
}

const { categories } = loadMenu()

const ITEM_MAP = {}
for (const cat of categories) {
    for (const item of cat.items) {
        ITEM_MAP[item.name] = { ...item, category: cat.name }
    }
}

// --------------------
// ROUTING
// --------------------
const WAITRESS_CATEGORIES = ['Beers 🍺', 'Soft Drinks 🥤']

function getWaitressGroup(table) {
    const num = parseInt(table.replace('Table ', ''))
    return num <= 3 ? WAITRESS_1_GROUP_ID : WAITRESS_2_GROUP_ID
}

function splitCart(cart) {
    const waitressItems = []
    const bartenderItems = []
    for (const item of cart) {
        const menuEntry = ITEM_MAP[item.name]
        if (menuEntry && WAITRESS_CATEGORIES.includes(menuEntry.category)) {
            waitressItems.push(item)
        } else {
            bartenderItems.push(item)
        }
    }
    return { waitressItems, bartenderItems }
}

// --------------------
// KEYBOARDS
// --------------------
const tableKeyboard = Markup.keyboard([
    ['Table 1', 'Table 2', 'Table 3'],
    ['Table 4', 'Table 5', 'Table 6']
]).resize().oneTime()

function buildMainMenu() {
    const categoryButtons = categories.map(cat => cat.name)
    const catRows = []
    for (let i = 0; i < categoryButtons.length; i += 2) {
        catRows.push(categoryButtons.slice(i, i + 2))
    }
    return Markup.keyboard([
        ...catRows,
        ['🛒 View Cart', '✅ Checkout'],
        ['🗑 Clear Cart', '🧾 Request Bill']
    ]).resize()
}

function buildCategoryMenu(categoryName) {
    const cat = categories.find(c => c.name === categoryName)
    if (!cat) return buildMainMenu()
    const itemButtons = cat.items.map(item => `${item.name} — ${item.price} ETB`)
    const rows = []
    for (let i = 0; i < itemButtons.length; i += 2) {
        rows.push(itemButtons.slice(i, i + 2))
    }
    return Markup.keyboard([...rows, ['⬅️ Back to Menu']]).resize()
}

// --------------------
// SESSION
// --------------------
bot.use(session({
    defaultSession: () => ({
        table: null,
        cart: [],
        tab: [],
        orderId: null,   // Supabase order ID for this table visit
        step: 'idle',
        activeCategory: null
    })
}))

// --------------------
// HELPERS
// --------------------
function resetSession(ctx) {
    ctx.session.table = null
    ctx.session.cart = []
    ctx.session.tab = []
    ctx.session.orderId = null
    ctx.session.step = 'idle'
    ctx.session.activeCategory = null
}

function requireTable(ctx) {
    if (!ctx.session.table) {
        ctx.reply(
            '⚠️ Please select your table first.',
            Markup.inlineKeyboard([
                Markup.button.callback('🍺 Start Ordering', 'START_ORDER')
            ])
        )
        return false
    }
    return true
}

function formatItems(items) {
    return items.map(i => `  - ${i.name} x ${i.qty}`).join('\n')
}

// --------------------
// SUPABASE HELPERS
// --------------------

// Create a new order record when a table starts ordering
async function createOrder(table, customer) {
    const { data, error } = await supabase
        .from('orders')
        .insert({ table_name: table, customer, total: 0, status: 'open' })
        .select('id')
        .single()
    if (error) { console.error('createOrder error:', error); return null }
    return data.id
}

// Save items from a round to order_items
async function saveRoundItems(orderId, roundNumber, items) {
    const rows = items.map(i => ({
        order_id: orderId,
        round_number: roundNumber,
        item_name: i.name,
        category: ITEM_MAP[i.name]?.category ?? 'Unknown',
        qty: i.qty,
        price: i.price
    }))
    const { error } = await supabase.from('order_items').insert(rows)
    if (error) console.error('saveRoundItems error:', error)
}

// Update the order total and mark as paid
async function markOrderPaid(orderId, total) {
    const { error } = await supabase
        .from('orders')
        .update({ status: 'paid', total, paid_at: new Date().toISOString() })
        .eq('id', orderId)
    if (error) console.error('markOrderPaid error:', error)
}

// --------------------
// ORDER NOTIFICATIONS
// --------------------
async function sendOrderNotifications(table, customer, roundNumber, cart) {
    const { waitressItems, bartenderItems } = splitCart(cart)
    const waitressGroup = getWaitressGroup(table)
    const orderId = `${table.replace(' ', '')}_R${roundNumber}_${Date.now()}`

    const statusButtons = (id) => ({
        reply_markup: {
            inline_keyboard: [[
                { text: '👀 Received',    callback_data: `status_received_${id}` },
                { text: '🔄 In progress', callback_data: `status_inprogress_${id}` },
                { text: '✅ Served',      callback_data: `status_served_${id}` }
            ]]
        }
    })

    if (waitressItems.length > 0) {
        const text =
            `🛎 NEW ORDER - Round ${roundNumber}\n\n` +
            `Table: ${table}\n` +
            `Customer: ${customer}\n\n` +
            `Items:\n${formatItems(waitressItems)}`
        await bot.telegram.sendMessage(waitressGroup, text, statusButtons(`W_${orderId}`))
    }

    if (bartenderItems.length > 0) {
        const text =
            `🍾 NEW ORDER - Round ${roundNumber}\n\n` +
            `Table: ${table}\n` +
            `Customer: ${customer}\n\n` +
            `Items:\n${formatItems(bartenderItems)}`
        await bot.telegram.sendMessage(BARTENDER_GROUP_ID, text, statusButtons(`B_${orderId}`))
    }
}

// --------------------
// DASHBOARD URL
// --------------------
const DASHBOARD_URL = 'https://zingy-gumption-99ad2b.netlify.app/'

// --------------------
// START
// --------------------
bot.start((ctx) => {
    if (ctx.chat.type !== 'private') return
    resetSession(ctx)
    ctx.reply(
        `🍻 Welcome!\n\nTap below to pick your table and start ordering 👇`,
        Markup.inlineKeyboard([
            Markup.button.callback('🍺 Start Ordering', 'START_ORDER')
        ])
    )
})

// --------------------
// START_ORDER
// --------------------
bot.action('START_ORDER', async (ctx) => {
    await ctx.answerCbQuery()
    ctx.session.step = 'selecting_table'
    ctx.reply('Select your table:', tableKeyboard)
})

// --------------------
// TABLE SELECTION
// --------------------
bot.hears(/^Table \d+$/, async (ctx) => {
    if (ctx.session.step !== 'selecting_table') {
        return ctx.reply('⚠️ You already have a table. Use the menu below.', buildMainMenu())
    }
    const table = ctx.match[0]
    const customer = ctx.from.first_name

    // Create order in Supabase as soon as table is selected
    const orderId = await createOrder(table, customer)
    ctx.session.orderId = orderId
    ctx.session.table = table
    ctx.session.step = 'ordering'

    ctx.reply(`✅ You are at ${table}. What would you like to order?`, buildMainMenu())
})

// --------------------
// CATEGORY NAVIGATION
// --------------------
const categoryNames = categories.map(c => c.name)

bot.hears(categoryNames, (ctx) => {
    if (!requireTable(ctx)) return
    const categoryName = ctx.message.text
    ctx.session.activeCategory = categoryName
    ctx.session.step = 'browsing_category'
    ctx.reply(`${categoryName}\n\nChoose an item:`, buildCategoryMenu(categoryName))
})

bot.hears('⬅️ Back to Menu', (ctx) => {
    ctx.session.activeCategory = null
    ctx.session.step = 'ordering'
    ctx.reply('What else would you like?', buildMainMenu())
})

// --------------------
// ADD TO CART
// --------------------
bot.hears(/^(.+) — \d+ ETB$/, (ctx) => {
    if (!requireTable(ctx)) return
    const itemName = ctx.match[1]
    const item = ITEM_MAP[itemName]
    if (!item) return ctx.reply('Item not found ❌', buildMainMenu())
    const cart = ctx.session.cart
    const existing = cart.find(i => i.name === item.name)
    if (existing) {
        existing.qty += 1
    } else {
        cart.push({ name: item.name, price: item.price, qty: 1 })
    }
    ctx.reply(
        `✅ ${item.name} added to cart!\n\nAdd more or go back to the menu.`,
        buildCategoryMenu(ctx.session.activeCategory)
    )
})

// --------------------
// VIEW CART
// --------------------
bot.hears('🛒 View Cart', (ctx) => {
    if (!requireTable(ctx)) return
    const cart = ctx.session.cart
    if (!cart.length) return ctx.reply('Your cart is empty 🛒', buildMainMenu())
    const lines = cart.map(i => `• ${i.name} x ${i.qty} = ${i.price * i.qty} ETB`)
    const total = cart.reduce((sum, i) => sum + i.price * i.qty, 0)
    ctx.reply(
        `🛒 Your Cart:\n\n${lines.join('\n')}\n\nTotal: ${total} ETB`,
        buildMainMenu()
    )
})

// --------------------
// CLEAR CART
// --------------------
bot.hears('🗑 Clear Cart', (ctx) => {
    if (!requireTable(ctx)) return
    ctx.session.cart = []
    ctx.reply('Cart cleared 🗑', buildMainMenu())
})

// --------------------
// CHECKOUT
// --------------------
bot.hears('✅ Checkout', async (ctx) => {
    if (!requireTable(ctx)) return
    const { cart, table, orderId } = ctx.session
    const customer = ctx.from.first_name
    if (!cart.length) return ctx.reply('Your cart is empty ❌', buildMainMenu())

    const roundNumber = ctx.session.tab.length + 1
    ctx.session.tab.push({ round: roundNumber, items: [...cart] })
    ctx.session.cart = []

    // Save round to Supabase
    if (orderId) await saveRoundItems(orderId, roundNumber, cart)

    await sendOrderNotifications(table, customer, roundNumber, cart)
    ctx.reply(
        `✅ Round ${roundNumber} sent!\n\nKeep ordering or request your bill when ready.`,
        buildMainMenu()
    )
})

// --------------------
// REQUEST BILL
// --------------------
bot.hears('🧾 Request Bill', (ctx) => {
    if (!requireTable(ctx)) return
    const { cart, table, orderId } = ctx.session
    const customer = ctx.from.first_name
    const tab = ctx.session.tab
    const hasAnything = tab.length > 0 || cart.length > 0
    if (!hasAnything) return ctx.reply('No items on tab yet ❌', buildMainMenu())

    const allRounds = [...tab]
    if (cart.length > 0) {
        allRounds.push({ round: tab.length + 1, items: cart, pending: true })
    }

    let total = 0
    const breakdown = allRounds.map(round => {
        const roundLines = round.items.map(i => {
            const lineTotal = i.price * i.qty
            total += lineTotal
            return `    - ${i.name} x ${i.qty} = ${lineTotal} ETB`
        }).join('\n')
        const label = round.pending ? `Round ${round.round} (pending)` : `Round ${round.round}`
        return `${label}:\n${roundLines}`
    }).join('\n\n')

    const billText =
        `🧾 FINAL BILL\n\n` +
        `Table: ${table}\n` +
        `Customer: ${customer}\n\n` +
        `${breakdown}\n\n` +
        `💰 TOTAL: ${total} ETB`

    // Pass orderId and total in callback so paid handler can update Supabase
    // Using | as separator to avoid conflicts with spaces in table names
    bot.telegram.sendMessage(BARTENDER_GROUP_ID, billText, {
        reply_markup: {
            inline_keyboard: [[{
                text: '💰 PAID',
                callback_data: `paid|${table}|${orderId}|${total}`
            }]]
        }
    })

    ctx.reply(`💰 Bill requested! Total: ${total} ETB\nThe bartender will confirm your payment.`)
})

// --------------------
// PAID
// --------------------
bot.action(/^paid/, async (ctx) => {
    const data = ctx.callbackQuery.data
    // format: paid|{table}|{orderId}|{total}
    const parts = data.split('|')
    const table = parts[1]
    const orderId = parts[2]
    const total = parseInt(parts[3]) || 0

    console.log(`PAID handler: table=${table} orderId=${orderId} total=${total}`)

    await ctx.answerCbQuery('Payment confirmed ✅')
    await ctx.editMessageText(
        ctx.callbackQuery.message.text + '\n\n✅ PAID',
        { reply_markup: { inline_keyboard: [] } }
    ).catch(() => {})

    // Mark order as paid in Supabase
    if (orderId && orderId !== 'null') await markOrderPaid(orderId, total)

    // Notify owner group with daily running total
    if (OWNER_GROUP_ID) {
        const today = new Date().toISOString().split('T')[0]
        const { data: todayOrders } = await supabase
            .from('orders')
            .select('total')
            .eq('status', 'paid')
            .gte('paid_at', `${today}T00:00:00`)

        const dailyTotal = todayOrders?.reduce((sum, o) => sum + o.total, 0) ?? 0

        bot.telegram.sendMessage(
            OWNER_GROUP_ID,
            `💰 PAYMENT RECEIVED\n\n` +
            `Table: ${table}\n` +
            `Bill: ${total} ETB\n\n` +
            `📊 Today's total so far: ${dailyTotal} ETB`,
            {
                reply_markup: {
                    inline_keyboard: [[
                        { text: '📊 Open Dashboard', web_app: { url: DASHBOARD_URL } }
                    ]]
                }
            }
        )
    }

    bot.telegram.sendMessage(BARTENDER_GROUP_ID, `✅ PAYMENT COMPLETED\n${table} is now closed`)
})

// --------------------
// ORDER STATUS
// --------------------
bot.action(/^status_/, async (ctx) => {
    const data = ctx.callbackQuery.data
    const parts = data.split('_')
    const action = parts[1]
    const idParts = parts.slice(2).join('_')
    const staffLabel = idParts.startsWith('W') ? 'Waitress' : 'Bartender'

    const statusMap = {
        received:   { text: '👀 Received',    answer: 'Marked as received!' },
        inprogress: { text: '🔄 In progress', answer: 'Marked as in progress!' },
        served:     { text: '✅ Served',      answer: 'Marked as served!' }
    }

    const status = statusMap[action]
    if (!status) return ctx.answerCbQuery('Unknown status')
    await ctx.answerCbQuery(status.answer)

    const originalText = ctx.callbackQuery.message.text
    const cleanText = originalText.replace(/\n\nStatus:.*$/s, '')
    const statusLine = `\n\nStatus: ${status.text} (${staffLabel})`

    await ctx.editMessageText(cleanText + statusLine, {
        reply_markup: {
            inline_keyboard: [[
                { text: '👀 Received',    callback_data: `status_received_${idParts}` },
                { text: '🔄 In progress', callback_data: `status_inprogress_${idParts}` },
                { text: '✅ Served',      callback_data: `status_served_${idParts}` }
            ]]
        }
    }).catch(() => {})
})

// --------------------
// LAUNCH
// --------------------
// --------------------
// DASHBOARD COMMAND (owner group only)
// --------------------
bot.command('dashboard', (ctx) => {
    if (ctx.chat.id !== OWNER_GROUP_ID) return
    ctx.reply(
        `📊 *Bar Dashboard*\n\nTap below to open the owner dashboard:`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[
                    { text: '📊 Open Dashboard', web_app: { url: DASHBOARD_URL } }
                ]]
            }
        }
    )
})

// Also send dashboard button whenever a payment is completed
// (already done in paid handler — button added below)

bot.launch()
console.log('🍻 Bar POS Bot Running...')

process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))