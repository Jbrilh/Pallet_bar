const { supabase } = require('./client')

function generateCode() {
    return Math.random().toString(36).substring(2, 10).toUpperCase()
}

async function getBarByOwner(ownerTelegramId) {
    const { data } = await supabase
        .from('bars')
        .select('*')
        .eq('owner_telegram_id', ownerTelegramId)
        .single()
    return data
}

async function createPendingBar(ownerTelegramId, ownerName, barName) {
    const { data, error } = await supabase
        .from('bars')
        .insert({ name: barName, owner_telegram_id: ownerTelegramId, owner_name: ownerName, status: 'pending' })
        .select('id')
        .single()
    if (error) { console.error('createPendingBar error:', error); return null }
    return data.id
}

async function approveBar(barId) {
    const code = generateCode()
    const { data, error } = await supabase
        .from('bars')
        .update({ status: 'approved', deep_link_code: code })
        .eq('id', barId)
        .select('owner_telegram_id, name')
        .single()
    if (error) { console.error('approveBar error:', error); return null }
    return { ...data, code }
}

async function rejectBar(barId) {
    const { data, error } = await supabase
        .from('bars')
        .update({ status: 'rejected' })
        .eq('id', barId)
        .select('owner_telegram_id, name')
        .single()
    if (error) { console.error('rejectBar error:', error); return null }
    return data
}

module.exports = { getBarByOwner, createPendingBar, approveBar, rejectBar }
