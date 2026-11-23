// Per-chat memory for the WhatsApp bot. Stores the last N messages in the
// existing wa_auth table (id = "chat-<jid>", data = { messages: [...] }).
// Messages use OpenAI-style { role, content } ("user" / "assistant").
// Rows saved earlier in Gemini's { role, parts } format are converted on read.

function createChatMemory({ url, key, limit = 20 }) {
    const rowId = (jid) => `chat-${jid}`;

    const headers = () => ({
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
    });

    // Convert old Gemini-format entries ({ role: 'model', parts }) to OpenAI format.
    const toOpenAI = (m) => {
        const role = m.role === 'model' || m.role === 'assistant' ? 'assistant' : 'user';
        const content = m.content !== undefined
            ? m.content
            : (m.parts || []).map(p => p.text || '').join('');
        return { role, content };
    };

    // Keep the newest `limit` messages and make sure history starts with a user turn.
    const trim = (messages) => {
        let out = messages.slice(-limit);
        while (out.length && out[0].role !== 'user') out = out.slice(1);
        return out;
    };

    const load = async (jid) => {
        try {
            const res = await fetch(
                `${url}/rest/v1/wa_auth?id=eq.${encodeURIComponent(rowId(jid))}&select=data`,
                { headers: headers() }
            );
            if (!res.ok) return [];
            const rows = await res.json();
            const messages = rows?.[0]?.data?.messages;
            return Array.isArray(messages) ? trim(messages.map(toOpenAI).filter(m => m.content)) : [];
        } catch (e) {
            console.error('Chat memory read error:', e.message || e);
            return [];
        }
    };

    const save = async (jid, messages) => {
        try {
            const res = await fetch(`${url}/rest/v1/wa_auth`, {
                method: 'POST',
                headers: { ...headers(), 'Prefer': 'resolution=merge-duplicates' },
                body: JSON.stringify({ id: rowId(jid), data: { messages: trim(messages) } })
            });
            if (!res.ok) console.error('Chat memory write failed, HTTP', res.status);
        } catch (e) {
            console.error('Chat memory write error:', e.message || e);
        }
    };

    // Called only after a successful reply, so a failed API call never leaves a dangling user turn.
    const append = (jid, history, userText, botText) => save(jid, [
        ...history,
        { role: 'user', content: userText },
        { role: 'assistant', content: botText }
    ]);

    return { load, save, append, trim };
}

module.exports = { createChatMemory };
