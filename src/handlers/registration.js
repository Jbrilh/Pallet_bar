const { bot } = require('../bot')
const { SUPER_ADMIN_ID, BOT_USERNAME, DASHBOARD_URL } = require('../config')
const { getBarByOwner, createPendingBar, approveBar, rejectBar } = require('../db/bars')

// Intercepts text input when owner is in registration flow
bot.use(async (ctx, next) => {
    if (
        ctx.message?.text &&
        ctx.chat?.type === 'private' &&
        ctx.session.registrationStep === 'awaiting_name'
    ) {
        const barName = ctx.message.text.trim()
        ctx.session.registrationStep = null

        const ownerName = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ')
        const barId = await createPendingBar(ctx.from.id, ownerName, barName)

        if (!barId) {
            return ctx.reply('⚠️ Something went wrong. Please try again with /register.')
        }

        await ctx.reply(
            `✅ Registration request sent!\n\nBar: *${barName}*\n\nYou'll be notified once the admin reviews your request.`,
            { parse_mode: 'Markdown' }
        )

        await bot.telegram.sendMessage(
            SUPER_ADMIN_ID,
            `🏢 *New Bar Registration*\n\nBar: *${barName}*\nOwner: ${ownerName}\nTelegram ID: \`${ctx.from.id}\``,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[
                        { text: '✅ Approve', callback_data: `approve_bar_${barId}` },
                        { text: '❌ Reject',  callback_data: `reject_bar_${barId}` }
                    ]]
                }
            }
        )
        return
    }
    return next()
})

// --------------------
// /register COMMAND
// --------------------
bot.command('register', async (ctx) => {
    if (ctx.chat.type !== 'private') return

    const existing = await getBarByOwner(ctx.from.id)
    if (existing) {
        const msg = {
            pending:  '⏳ Your registration is pending admin approval.',
            approved: '✅ Your bar is already registered and approved!',
            rejected: '❌ Your registration was rejected. Contact the admin for more info.'
        }
        return ctx.reply(msg[existing.status] || 'You already have a bar registered.')
    }

    ctx.session.registrationStep = 'awaiting_name'
    ctx.reply('🏢 What is the name of your bar?')
})

// --------------------
// APPROVE / REJECT (shared handler)
// --------------------
async function handleBarDecision(ctx, approved) {
    if (ctx.from.id !== SUPER_ADMIN_ID) return ctx.answerCbQuery()

    const prefix = approved ? 'approve_bar_' : 'reject_bar_'
    const barId = ctx.callbackQuery.data.replace(prefix, '')
    const result = approved ? await approveBar(barId) : await rejectBar(barId)

    if (!result) return ctx.answerCbQuery('⚠️ Failed — try again')

    const label = approved ? '✅ APPROVED' : '❌ REJECTED'
    await ctx.answerCbQuery(approved ? 'Approved ✅' : 'Rejected ❌')
    await ctx.editMessageText(
        ctx.callbackQuery.message.text + `\n\n${label}`,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [] } }
    ).catch(() => {})

    if (approved) {
        const deepLink = `https://t.me/${BOT_USERNAME}?start=bar_${result.code}`
        await bot.telegram.sendMessage(
            result.owner_telegram_id,
            `🎉 *Your bar has been approved!*\n\n` +
            `Bar: *${result.name}*\n` +
            `Bar code: \`${result.code}\`\n\n` +
            `📲 *Customer QR link:*\n${deepLink}\n\n` +
            `📊 *Dashboard:*\n${DASHBOARD_URL}\n` +
            `_(login with your bar code above)_\n\n` +
            `*Next steps:*\n` +
            `1. Open the dashboard and log in with your bar code\n` +
            `2. Set up your menu and staff\n` +
            `3. Print the QR code for your tables`,
            { parse_mode: 'Markdown' }
        )
    } else {
        await bot.telegram.sendMessage(
            result.owner_telegram_id,
            `❌ Your bar registration for *${result.name}* was not approved.\n\nContact the admin for more information.`,
            { parse_mode: 'Markdown' }
        )
    }
}

bot.action(/^approve_bar_/, ctx => handleBarDecision(ctx, true))
bot.action(/^reject_bar_/, ctx => handleBarDecision(ctx, false))
