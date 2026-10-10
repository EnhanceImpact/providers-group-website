import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const { firstName, email, zipCode, marketingOptIn, resourceSlug } = await req.json()
    if (!email || !resourceSlug) throw new Error('Email and resource are required.')

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )
    const normalized = String(email).trim().toLowerCase()
    const { data: existing } = await supabase.from('contacts').select('id,marketing_opt_in,marketing_consent_at').ilike('email', normalized).maybeSingle()
    let contactId = existing?.id
    if (contactId) {
      await supabase.from('contacts').update({
        first_name: firstName || undefined,
        zip_code: zipCode || undefined,
        marketing_opt_in: Boolean(existing.marketing_opt_in || marketingOptIn),
        marketing_consent_at: existing.marketing_consent_at || (marketingOptIn ? new Date().toISOString() : null),
        updated_at: new Date().toISOString()
      }).eq('id', contactId)
    } else {
      const { data, error } = await supabase.from('contacts').insert({
        first_name: firstName || null, email: normalized, zip_code: zipCode || null,
        marketing_opt_in: Boolean(marketingOptIn),
        marketing_consent_at: marketingOptIn ? new Date().toISOString() : null
      }).select('id').single()
      if (error) throw error
      contactId = data.id
    }

    const { data: resource, error: resourceError } = await supabase.from('resources').select('id,storage_path').eq('slug', resourceSlug).eq('is_active', true).single()
    if (resourceError) throw resourceError
    await supabase.from('resource_downloads').insert({ contact_id: contactId, resource_id: resource.id })
    const { data: signed, error: signedError } = await supabase.storage.from('resources').createSignedUrl(resource.storage_path, 300)
    if (signedError) throw signedError
    return new Response(JSON.stringify({ ok: true, downloadUrl: signed.signedUrl }), { headers: { ...cors, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : 'Request failed' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } })
  }
})
