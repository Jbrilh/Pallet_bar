const { createClient } = require('@supabase/supabase-js')

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gzwxcdjvezevyvicamgc.supabase.co'

// Service role key bypasses RLS — used by the bot server only, never exposed to clients
const supabase = createClient(
    SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY
)

module.exports = { supabase }
