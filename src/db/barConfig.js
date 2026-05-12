const { supabase } = require('./client')

const configCache = new Map()  // barId → { data, at }
const chatIdCache = new Map()  // chatId → barId
const TTL = 5 * 60 * 1000

async function getBarConfig(barId) {
    const hit = configCache.get(barId)
    if (hit && Date.now() - hit.at < TTL) return hit.data

    const [
        { data: bar },
        { data: groups },
        { data: tables },
        { data: categories },
        { data: items },
        { data: staff }
    ] = await Promise.all([
        supabase.from('bars').select('*').eq('id', barId).single(),
        supabase.from('bar_groups').select('*').eq('bar_id', barId),
        supabase.from('bar_tables').select('*').eq('bar_id', barId).order('table_name'),
        supabase.from('bar_menu_categories').select('*').eq('bar_id', barId).order('sort_order'),
        supabase.from('bar_menu_items').select('*').eq('bar_id', barId).eq('is_available', true).order('sort_order'),
        supabase.from('bar_staff').select('telegram_user_id').eq('bar_id', barId)
    ])

    const groupMap = Object.fromEntries((groups || []).map(g => [g.id, g]))
    const categoryMap = Object.fromEntries((categories || []).map(c => [c.id, c]))

    const itemMap = {}
    for (const item of (items || [])) {
        itemMap[item.name] = {
            ...item,
            categoryName: categoryMap[item.category_id]?.name ?? 'Unknown'
        }
    }

    const tableGroupMap = {}
    for (const t of (tables || [])) {
        tableGroupMap[t.table_name] = groupMap[t.group_id] ?? null
    }

    const config = {
        bar: bar || {},
        groups: groups || [],
        groupMap,
        categoryMap,
        tables: tables || [],
        tableGroupMap,
        categories: categories || [],
        items: items || [],
        itemMap,
        staffIds: (staff || []).map(s => s.telegram_user_id)
    }

    configCache.set(barId, { data: config, at: Date.now() })
    for (const g of (groups || [])) chatIdCache.set(g.chat_id, barId)

    return config
}

async function getBarByCode(code) {
    const { data } = await supabase
        .from('bars')
        .select('id, status')
        .eq('deep_link_code', code)
        .single()
    return data
}

async function getBarByChatId(chatId) {
    if (chatIdCache.has(chatId)) return chatIdCache.get(chatId)

    const { data, error } = await supabase
        .from('bar_groups')
        .select('bar_id')
        .eq('chat_id', chatId)
        .single()

    if (error) console.error(`getBarByChatId(${chatId}) error:`, error.message)
    if (!data) return null
    chatIdCache.set(chatId, data.bar_id)
    return data.bar_id
}

function invalidateCache(barId) {
    const hit = configCache.get(barId)
    if (hit) {
        for (const g of (hit.data.groups || [])) chatIdCache.delete(g.chat_id)
    }
    configCache.delete(barId)
}

module.exports = { getBarConfig, getBarByCode, getBarByChatId, invalidateCache }
