const { supabase } = require('./client')
const { OWNER_GROUP_ID } = require('../config')
const { bot } = require('../bot')

async function deductStock(cart) {
    for (const item of cart) {
        const { data: stockRow, error } = await supabase
            .from('stock')
            .select('id, quantity, low_stock_threshold')
            .eq('item_name', item.name)
            .single()

        if (error || !stockRow) continue

        const newQty = Math.max(0, stockRow.quantity - item.qty)

        await supabase
            .from('stock')
            .update({ quantity: newQty, updated_at: new Date().toISOString() })
            .eq('id', stockRow.id)

        if (newQty <= stockRow.low_stock_threshold) {
            const emoji = newQty === 0 ? '❌' : '⚠️'
            const status = newQty === 0 ? 'OUT OF STOCK' : 'LOW STOCK'
            await bot.telegram.sendMessage(
                OWNER_GROUP_ID,
                `${emoji} ${status} ALERT\n\n` +
                `Item: ${item.name}\n` +
                `Remaining: ${newQty} units\n` +
                `Threshold: ${stockRow.low_stock_threshold} units\n\n` +
                `Please restock soon!`
            ).catch(e => console.log('Stock alert error:', e.message))
        }
    }
}

module.exports = { deductStock }
