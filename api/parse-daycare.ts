/**
 * Vercel serverless function: daycare app screenshot → sleep/feed rows.
 *
 * Cost-capped by design (single screenshot, at most once a day): cheapest
 * vision-capable model, a low max_tokens that makes a runaway response
 * structurally impossible, and the account's own hard monthly spend cap
 * (set that in the Anthropic console — this code can't enforce it).
 *
 * Never writes to the database — the parsed rows land in the same editable
 * batch form as manual entry (DaycareImport), and only save on an explicit
 * user tap, same as the rest of the app.
 *
 * Auth: requires a valid Supabase user JWT for a caregiver account.
 * Env (Vercel): ANTHROPIC_API_KEY (server-only), plus the VITE_SUPABASE_* pair.
 */

import Anthropic from '@anthropic-ai/sdk';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// The prompt below is tuned to the "Dagritme" summary screen of one Dutch
// daycare app. If yours looks different, adjust the labels/format here.
const SYSTEM = `You are reading a screenshot from a daycare app's daily
summary. Extract ONLY sleep sessions and bottle feeds — nothing else.

Conventions:
- Each relevant row has an icon, a time (or time range), a label, and
  sometimes a grey detail line below it. The layout reflows — a free-text
  carer note can push later rows further down the screen — so match rows by
  their icon/label pattern, not by vertical position.
- "Slapen" (sleep) rows show a time range, e.g. "12:15 - 14:00". Extract
  just the start and end time (24h HH:MM). Ignore any separately printed
  duration ("2 uur 43 min") — the app recomputes duration from start/end
  itself, so never trust or transcribe theirs.
- "Flesvoeding" (bottle feed) rows show a single time, with an amount like
  "150 cc melk" on the detail line below. cc = mL, 1:1 — extract the number
  as-is. Feeds have exactly one time each, never a range.
- Ignore every other row type (arrival/pickup, activities, meals, diaper
  changes, photos, etc.) and all free-text carer notes entirely — do not
  transcribe, summarize, or otherwise report them.
- If a row's time or amount is illegible or ambiguous, omit that row and add
  a short human-readable warning instead of guessing at a value.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['rows', 'warnings'],
  properties: {
    warnings: { type: 'array', items: { type: 'string' } },
    rows: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'start', 'end', 'time', 'ml'],
        properties: {
          kind: { type: 'string', enum: ['sleep', 'feed'] },
          start: { type: ['string', 'null'], description: 'HH:MM 24h — sleep rows only' },
          end: { type: ['string', 'null'], description: 'HH:MM 24h — sleep rows only' },
          time: { type: ['string', 'null'], description: 'HH:MM 24h — feed rows only' },
          ml: { type: ['integer', 'null'], description: 'feed rows only' },
        },
      },
    },
  },
} as const;

/** Validate the caller's Supabase JWT and confirm they're a caregiver on at
 * least one child, so an unauthenticated/unrelated caller can't spend the
 * family's Anthropic budget even though this URL is public. */
async function authedCaregiver(req: VercelRequest): Promise<SupabaseClient | null> {
  const url = process.env.VITE_SUPABASE_URL;
  const anon = process.env.VITE_SUPABASE_ANON_KEY;
  const authz = req.headers.authorization;
  if (!url || !anon || !authz) return null;
  const resp = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: anon, Authorization: authz },
  });
  if (!resp.ok) return null;
  const db = createClient(url, anon, {
    global: { headers: { Authorization: authz } },
    auth: { persistSession: false },
  });
  const { count } = await db.from('caregivers').select('child_id', { count: 'exact', head: true });
  return count ? db : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not configured in Vercel' });
  }
  if (!(await authedCaregiver(req))) {
    return res.status(401).json({ error: 'Sign in with a caregiver account to use this' });
  }

  const { image, mediaType } = (req.body ?? {}) as { image?: string; mediaType?: string };
  if (!image || typeof image !== 'string') {
    return res.status(400).json({ error: 'Missing image (base64)' });
  }
  if (image.length > 5_000_000) {
    return res.status(413).json({ error: 'Image too large — retake or downscale' });
  }

  const client = new Anthropic();
  try {
    const response = await client.messages.create({
      // Cheapest vision-capable tier — this is a once-a-day, low-stakes read.
      model: 'claude-haiku-4-5-20251001',
      // Six-ish structured rows fit comfortably; this cap also makes a
      // runaway/expensive response structurally impossible, not just unlikely.
      max_tokens: 200,
      system: SYSTEM,
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: (mediaType ?? 'image/jpeg') as 'image/jpeg',
              data: image,
            },
          },
          { type: 'text', text: "Extract this daycare summary's sleep and feed rows." },
        ],
      }],
    });

    if (response.stop_reason === 'refusal') {
      return res.status(502).json({ error: 'The model declined to read this image' });
    }
    if (response.stop_reason === 'max_tokens') {
      return res.status(502).json({ error: 'Too many rows for one read — enter the rest manually' });
    }
    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') {
      return res.status(502).json({ error: 'No result produced' });
    }
    return res.status(200).json(JSON.parse(text.text));
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ error: 'Rate limited — try again in a minute' });
    }
    if (err instanceof Anthropic.APIError) {
      return res.status(502).json({ error: `Claude API error: ${err.message}` });
    }
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Unexpected error' });
  }
}
