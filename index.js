require('dotenv').config()

const { Telegraf, Markup, session } = require('telegraf')
const fs = require('fs')
const path = require('path')

// --------------------
// BOT INIT
// --------------------
const bot = new Telegraf(process.env.BOT_TOKEN)

// --------------------
// GROUP ID
// --------------------
const GROUP_ID = -5098569760

// --------------------
// LOAD MENU FROM JSON
// Menu is loaded once at startup. To update the menu,
// edit menu.json and redeploy (or restart the bot).
// --------------------
function loadMenu() {
    const raw = fs.readFileSync(path.join(__dirname, 'menu.json'), 'utf8')
    return JSON.parse(raw)
}

const { categories } = loadMenu()

// Build a flat lookup map: "Item Name" => { name, price, category }
// Used to resolve any ordered item quickly
const ITEM_MAP = {}
for (const cat of categories) {
    for (const item of cat.items) {
        ITEM_MAP[item.name] = { ...item, category: cat.name }
    }
}

// --------------------
// KEYBOARD BUILDERS
// --------------------
const tableKeyboard = Markup.keyboard([
    ['Table 1', 'Table 2', 'Table 3'],
    ['Table 4', 'Table 5', 'Table 6']
]).resize().oneTime()

// Main menu: category buttons + cart actions + request bill always last
function buildMainMenu() {
    const categoryButtons = categories.map(cat => cat.name)

    // Split category buttons into rows of 2
    const catRows = []
    for (let i = 0; i < categoryButtons.length; i += 2) {
        catRows.push(categoryButtons.slice(i, i + 2))
    }

    return Markup.keyboard([
        ...catRows,
        ['🛒 View Cart', '✅ Checkout'],
        ['🗑 Clear Cart', '🧾 Request Bill']  // Request Bill always last
    ]).resize()
}

// Category submenu: list items + back button
function buildCategoryMenu(categoryName) {
    const cat = categories.find(c => c.name === categoryName)
    if (!cat) return buildMainMenu()

    const itemButtons = cat.items.map(item => `${item.name} — ${item.price} ETB`)

    // Split into rows of 2
    const rows = []
    for (let i = 0; i < itemButtons.length; i += 2) {
        rows.push(itemButtons.slice(i, i + 2))
    }

    return Markup.keyboard([
        ...rows,
        ['⬅️ Back to Menu']
    ]).resize()
}

// --------------------
// SESSION
// --------------------
bot.use(session({
    defaultSession: () => ({
        table: null,
        cart: [],        // current round being built
        tab: [],         // all confirmed rounds for this table visit
        step: 'idle',    // 'idle' | 'selecting_table' | 'ordering' | 'browsing_category'
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

// --------------------
// START
// --------------------
bot.start((ctx) => {
    resetSession(ctx)
    ctx.reply(
        `🍻 Welcome!\n\nTap below to pick your table and start ordering 👇`,
        Markup.inlineKeyboard([
            Markup.button.callback('🍺 Start Ordering', 'START_ORDER')
        ])
    )
})

// --------------------
// START_ORDER action
// --------------------
bot.action('START_ORDER', async (ctx) => {
    await ctx.answerCbQuery()
    ctx.session.step = 'selecting_table'
    ctx.reply('Select your table:', tableKeyboard)
})

// --------------------
// TABLE SELECTION
// --------------------
bot.hears(/^Table \d+$/, (ctx) => {
    if (ctx.session.step !== 'selecting_table') {
        return ctx.reply('⚠️ You already have a table. Use the menu below.', buildMainMenu())
    }

    const table = ctx.match[0]
    ctx.session.table = table
    ctx.session.step = 'ordering'

    ctx.reply(`✅ You are at ${table}. What would you like to order?`, buildMainMenu())
})

// --------------------
// CATEGORY NAVIGATION
// --------------------
// Match any category name dynamically
const categoryNames = categories.map(c => c.name)

bot.hears(categoryNames, (ctx) => {
    if (!requireTable(ctx)) return

    const categoryName = ctx.message.text
    ctx.session.activeCategory = categoryName
    ctx.session.step = 'browsing_category'

    const cat = categories.find(c => c.name === categoryName)
    ctx.reply(`${categoryName}\n\nChoose an item:`, buildCategoryMenu(categoryName))
})

// Back to main menu
bot.hears('⬅️ Back to Menu', (ctx) => {
    ctx.session.activeCategory = null
    ctx.session.step = 'ordering'
    ctx.reply('What else would you like?', buildMainMenu())
})

// --------------------
// ADD TO CART
// Match pattern: "Item Name — 120 ETB"
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
        `✅ ${item.name} added to cart!\n\nAdd more from ${ctx.session.activeCategory} or go back to the menu.`,
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

    const lines = cart.map(i => `• ${i.name} × ${i.qty} = ${i.price * i.qty} ETB`)
    const total = cart.reduce((sum, i) => sum + i.price * i.qty, 0)

    ctx.reply(
        `🛒 *Your Cart:*\n\n${lines.join('\n')}\n\n_Total: ${total} ETB_`,
        { parse_mode: 'Markdown', ...buildMainMenu() }
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
// CHECKOUT (send tab update to bartender)
// --------------------
bot.hears('✅ Checkout', (ctx) => {
    if (!requireTable(ctx)) return

    const { cart, table } = ctx.session
    const customer = ctx.from.first_name

    if (!cart.length) return ctx.reply('Your cart is empty ❌', buildMainMenu())

    const roundNumber = ctx.session.tab.length + 1
    const itemsText = cart.map(i => `  - ${i.name} × ${i.qty}`).join('\n')
    const orderText =
        `🧾 ORDER — Round ${roundNumber}\n\n` +
        `Table: ${table}\n` +
        `Customer: ${customer}\n\n` +
        `Items:\n${itemsText}\n\n` +
        `⏳ Running tab active`

    // Save this round to the tab and clear the cart
    ctx.session.tab.push({ round: roundNumber, items: [...cart] })
    ctx.session.cart = []

    bot.telegram.sendMessage(GROUP_ID, orderText)
    ctx.reply(`✅ Round ${roundNumber} sent to bar!\n\nKeep ordering or request your bill when ready.`, buildMainMenu())
})

// --------------------
// REQUEST BILL
// --------------------
bot.hears('🧾 Request Bill', (ctx) => {
    if (!requireTable(ctx)) return

    const { cart, table } = ctx.session
    const customer = ctx.from.first_name

    const tab = ctx.session.tab
    const hasAnything = tab.length > 0 || cart.length > 0
    if (!hasAnything) return ctx.reply('No items on tab yet ❌', buildMainMenu())

    // Include current unsubmitted cart as a pending round if not empty
    const allRounds = [...tab]
    if (cart.length > 0) {
        allRounds.push({ round: tab.length + 1, items: cart, pending: true })
    }

    let total = 0
    const breakdown = allRounds.map(round => {
        const roundLines = round.items.map(i => {
            const lineTotal = i.price * i.qty
            total += lineTotal
            return `    - ${i.name} × ${i.qty} = ${lineTotal} ETB`
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

    bot.telegram.sendMessage(GROUP_ID, billText, {
        reply_markup: {
            inline_keyboard: [[{ text: '💰 PAID', callback_data: `paid_${table}` }]]
        }
    })

    ctx.reply(`💰 Bill requested! Total: ${total} ETB\nThe bartender will confirm your payment.`)
})

// --------------------
// PAID BUTTON HANDLER (bartender side)
// --------------------
bot.on('callback_query', async (ctx) => {
    const data = ctx.callbackQuery.data

    if (data === 'START_ORDER') return

    if (data.startsWith('paid_')) {
        const table = data.replace('paid_', '')

        // Find and reset the session for this table
        for (const [, sess] of Object.entries(bot.context?.sessions ?? {})) {
            if (sess.table === table) {
                sess.cart = []
                sess.tab = []
                sess.table = null
                sess.step = 'idle'
            }
        }

        await ctx.answerCbQuery('Payment confirmed ✅')
        bot.telegram.sendMessage(GROUP_ID, `✅ PAYMENT COMPLETED\n${table} is now closed`)
    }
})

// --------------------
// LAUNCH
// --------------------
bot.launch()
console.log('🍻 Bar POS Bot Running...')

process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))