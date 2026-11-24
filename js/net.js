// Realtime messaging between the host screen and the phones.
// Uses Supabase Realtime "broadcast" (no database tables needed).
// Falls back to BroadcastChannel (same-browser tabs) in demo mode.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const DEMO = !SUPABASE_URL || !SUPABASE_ANON_KEY;

export async function connect(code, onMsg, onStatus = () => {}) {
  const name = 'bardcore-' + String(code).toUpperCase();

  if (DEMO) {
    const bc = new BroadcastChannel(name);
    bc.onmessage = (e) => onMsg(e.data);
    queueMicrotask(() => onStatus('connected'));
    return { send: (m) => bc.postMessage(m), close: () => bc.close() };
  }

  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    realtime: { params: { eventsPerSecond: 30 } },
  });
  const ch = sb.channel(name, { config: { broadcast: { self: false, ack: false } } });
  ch.on('broadcast', { event: 'm' }, ({ payload }) => onMsg(payload));

  await new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; reject(new Error('Timed out connecting to Supabase')); }
    }, 12000);
    ch.subscribe((status, err) => {
      if (status === 'SUBSCRIBED') {
        onStatus('connected');
        if (!settled) { settled = true; clearTimeout(timer); resolve(); }
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        onStatus('reconnecting');
        if (!settled) { settled = true; clearTimeout(timer); reject(err || new Error(status)); }
      }
    });
  });

  return {
    send: (m) => ch.send({ type: 'broadcast', event: 'm', payload: m }),
    close: () => sb.removeChannel(ch),
  };
}
