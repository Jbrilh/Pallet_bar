require('dotenv').config()

const { Telegraf, Markup, session } = require('telegraf')
const fs = require('fs')
const path = require('path')

const bot = new Telegraf(process.env.BOT_TOKEN)

const BARTENDER_GROUP_ID  = -5098569760
const WAITRESS_1_GROUP_ID = -5253381539
const WAITRESS_2_GROUP_ID = -5257042379

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

bot.on('message', (ctx) => {
    console.log('Chat ID:', ctx.chat.id, '| Chat title:', ctx.chat.title)
})

bot.use(session({
    defaultSession: () => ({
        table: null,
        cart: [],
        tab: [],
        step: 'idle',
        activeCategory: null
    })
}))

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

function formatItems(items) {
    return items.map(i => `  - ${i.name} x ${i.qty}`).join('\n')
}

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

bot.start((ctx) => {
    resetSession(ctx)
    ctx.reply(
        `🍻 Welcome!\n\nTap below to pick your table and start ordering 👇`,
        Markup.inlineKeyboard([
            Markup.button.callback('🍺 Start Ordering', 'START_ORDER')
        ])
    )
})

bot.action('START_ORDER', async (ctx) => {
    await ctx.answerCbQuery()
    ctx.session.step = 'selecting_table'
    ctx.reply('Select your table:', tableKeyboard)
})

bot.hears(/^Table \d+$/, (ctx) => {
    if (ctx.session.step !== 'selecting_table') {
        return ctx.reply('⚠️ You already have a table. Use the menu below.', buildMainMenu())
    }
    const table = ctx.match[0]
    ctx.session.table = table
    ctx.session.step = 'ordering'
    ctx.reply(`✅ You are at ${table}. What would you like to order?`, buildMainMenu())
})

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

bot.hears('🗑 Clear Cart', (ctx) => {
    if (!requireTable(ctx)) return
    ctx.session.cart = []
    ctx.reply('Cart cleared 🗑', buildMainMenu())
})

bot.hears('✅ Checkout', async (ctx) => {
    if (!requireTable(ctx)) return
    const { cart, table } = ctx.session
    const customer = ctx.from.first_name
    if (!cart.length) return ctx.reply('Your cart is empty ❌', buildMainMenu())
    const roundNumber = ctx.session.tab.length + 1
    ctx.session.tab.push({ round: roundNumber, items: [...cart] })
    ctx.session.cart = []
    await sendOrderNotifications(table, customer, roundNumber, cart)
    ctx.reply(
        `✅ Round ${roundNumber} sent!\n\nKeep ordering or request your bill when ready.`,
        buildMainMenu()
    )
})

bot.hears('🧾 Request Bill', (ctx) => {
    if (!requireTable(ctx)) return
    const { cart, table } = ctx.session
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

    bot.telegram.sendMessage(BARTENDER_GROUP_ID, billText, {
        reply_markup: {
            inline_keyboard: [[{ text: '💰 PAID', callback_data: `paid_${table}` }]]
        }
    })

    ctx.reply(`💰 Bill requested! Total: ${total} ETB\nThe bartender will confirm your payment.`)
})

// ---------- PAID ----------
bot.action(/^paid_/, async (ctx) => {
    const table = ctx.callbackQuery.data.replace('paid_', '')
    await ctx.answerCbQuery('Payment confirmed ✅')
    await ctx.editMessageText(
        ctx.callbackQuery.message.text + '\n\n✅ PAID',
        { reply_markup: { inline_keyboard: [] } }
    ).catch(() => {})
    bot.telegram.sendMessage(BARTENDER_GROUP_ID, `✅ PAYMENT COMPLETED\n${table} is now closed`)
})

// ---------- ORDER STATUS ----------
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

bot.launch()
console.log('🍻 Bar POS Bot Running...')

process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))