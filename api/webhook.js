// Policontrol Bot — Vercel + Claude API
const TELEGRAM_TOKEN = "8619850108:AAFk2alsfSQLocua9jPOkzgUD33XPFsIrdc";
const TG_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

const PROJECTS = [
  "Placa AP2000 (024/2024) [Des. Industrial] — turbidímetro, Maurício",
  "FlocControl Display (002/2025) [Des. Industrial] — retroiluminado",
  "MPN Reader (005/2025) [Des. Industrial] — idexx, cartela",
  "Medidor Presença (006/2025) [Des. Industrial] — oxitop",
  "AquaColor Flúor (007/2025) [Des. Industrial] — LED",
  "CL Track Online (010/2025) [Des. Industrial] — cloro online",
  "Medidor Cloro Pocket (005/2021) [Contratado] — Fiore, placa",
  "Poli Sealer (014/2022) [Contratado] — Unicorp, firmware",
  "Dispenser Powder Pillow (009/2023) [Contratado] — Victum, molde",
  "OxiPoli (009/2025) [Contratado] — sensor pressão",
  "Monitor Coagulante [Contratado] — AEGEA",
  "Poli Viewer [Des. Industrial] — gabinete, LEDs",
  "Reagente Cloro Online (039/2022) [Des. Químico] — Blue-i",
  "Alumínio Hach (004/2023) [Des. Químico]",
  "Reagente Manganês (001/2024) [Des. Químico] — sachê",
  "Cloro DPD Pastilha (010/2024) [Des. Químico]",
  "Padrão NTU Hach (014/2024) [Des. Químico]",
  "Stabgel Cloro (008/2025) [Des. Químico]",
  "Nitrogênio Total (011/2025) [Des. Químico]",
  "Fósforo Total (012/2025) [Des. Químico]",
  "Padrão DQO (006/2026) [Des. Químico]",
].join("\n• ");

async function callClaude(sysPrompt, userMsg) {
  const CLAUDE_KEY = process.env.CLAUDE_API_KEY;
  if (!CLAUDE_KEY) throw new Error("CLAUDE_API_KEY não configurada");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": CLAUDE_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, system: sysPrompt, messages: [{ role: "user", content: userMsg }] })
  });
  const d = await res.json();
  if (d.error) throw new Error(d.error.message);
  return d.content.map(i => i.text || "").join("").replace(/```json|```/g, "").trim();
}

async function sendTG(chatId, text, replyTo, buttons) {
  const body = { chat_id: chatId, text, parse_mode: "Markdown", reply_to_message_id: replyTo };
  if (buttons) body.reply_markup = JSON.stringify({ inline_keyboard: buttons });
  await fetch(`${TG_API}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

async function editTG(chatId, msgId, text) {
  await fetch(`${TG_API}/editMessageText`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, message_id: msgId, text, parse_mode: "Markdown" }) });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(200).send("Bot Policontrol ativo");
  const update = req.body;
  try {
    if (update.callback_query) { await handleCallback(update.callback_query); return res.status(200).send("OK"); }
    const msg = update.message;
    if (!msg) return res.status(200).send("OK");
    if (msg.photo && msg.reply_to_message) { await handlePhoto(msg); return res.status(200).send("OK"); }
    if (!msg.text) return res.status(200).send("OK");
    if (msg.text.startsWith("/")) { await handleCommand(msg); return res.status(200).send("OK"); }
    if (msg.reply_to_message && String(msg.reply_to_message.from?.id) === TELEGRAM_TOKEN.split(":")[0]) {
      await handleReply(msg); return res.status(200).send("OK");
    }
    await classifyMessage(msg);
  } catch (e) { console.error("Error:", e.message); }
  return res.status(200).send("OK");
}

async function classifyMessage(msg) {
  if (msg.text.length < 8) return;
  const userName = msg.from?.first_name || "Alguém";

  const sysPrompt = `Analise mensagem de grupo Policontrol. Projetos:\n• ${PROJECTS}\n\nCLASSIFIQUE (JSON puro):\n- Conversa casual/pergunta/opinião → {"type":"skip"}\n- FATO concreto sobre projeto (enviou, recebeu, testou, aprovou, comprou) → {"type":"update","project":"nome","whatDid":"o que fez"}`;

  try {
    const raw = await callClaude(sysPrompt, `${userName}: "${msg.text}"`);
    const result = JSON.parse(raw);
    if (result.type === "skip") return;

    const askPrompt = `Alguém atualizou o projeto "${result.project}": "${msg.text}"

Gere UMA mensagem curta pedindo o que falta para atualização completa:
- 📅 Data que foi feito (se não disse)
- ⏰ Previsão do próximo passo
- 🔬 Resultado/evidência (se aplicável)
- ⚡ Próximo passo

Comece com "📋 *${result.project}* — anotei, ${userName}!" + o que entendeu + peça o que falta. Máx 4 linhas. Texto direto, não JSON.`;

    const followUp = await callClaude(askPrompt, msg.text);
    await sendTG(msg.chat.id, followUp, msg.message_id);
  } catch (e) { console.error("Classify:", e.message); }
}

async function handleReply(msg) {
  const userName = msg.from?.first_name || "Alguém";
  const botQuestion = msg.reply_to_message.text || "";
  const originalMsg = msg.reply_to_message.reply_to_message?.text || "";

  const sysPrompt = `Compile atualização de projeto Policontrol.\n\nContexto:\n- Original: "${originalMsg}"\n- Bot perguntou: "${botQuestion}"\n- Resposta: "${msg.text}"\n\nRetorne JSON:\n{"project":"nome","summary":{"action":"o que fez","date":"quando","evidence":"evidência ou N/A","nextStep":"próximo passo","deadline":"previsão"},"complete":true/false,"followUp":"se incompleto, pergunta. Se completo, null"}\n\nSe disse "não sei", aceite. Se tem ação + 1 dado extra = complete.`;

  try {
    const raw = await callClaude(sysPrompt, `${userName}: "${msg.text}"`);
    const result = JSON.parse(raw);

    if (!result.complete && result.followUp) {
      await sendTG(msg.chat.id, `👍 Anotei!\n\n${result.followUp}`, msg.message_id);
      return;
    }

    const s = result.summary;
    let text = `📋 *Atualização: ${result.project}*\n\n`;
    text += `✅ *O quê:* ${s.action}\n`;
    text += `📅 *Quando:* ${s.date}\n`;
    if (s.evidence && s.evidence !== "N/A") text += `🔬 *Evidência:* ${s.evidence}\n`;
    text += `⚡ *Próximo:* ${s.nextStep}\n`;
    text += `⏰ *Previsão:* ${s.deadline}\n`;
    text += `\n👤 _${userName}_\n\n_Registro no sistema?_`;

    await sendTG(msg.chat.id, text, msg.message_id, [[
      { text: "✅ Registrar", callback_data: "reg" },
      { text: "❌ Descartar", callback_data: "del" }
    ]]);
  } catch (e) { console.error("Reply:", e.message); }
}

async function handlePhoto(msg) {
  await sendTG(msg.chat.id, `📷 *Foto recebida!* Registrei como evidência.`, msg.message_id);
}

async function handleCallback(cb) {
  const chatId = cb.message?.chat?.id, msgId = cb.message?.message_id, text = cb.message?.text || "";
  if (cb.data === "reg") {
    await editTG(chatId, msgId, text.replace("_Registro no sistema?_", "✅ *REGISTRADO*"));
  } else if (cb.data === "del") {
    await editTG(chatId, msgId, "❌ _Descartado._");
  }
  await fetch(`${TG_API}/answerCallbackQuery`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: cb.id }) });
}

async function handleCommand(msg) {
  const cmd = msg.text?.split("@")[0];
  if (cmd === "/start") {
    await sendTG(msg.chat.id, `🤖 *Bot Policontrol Projetos*\n\nMonitoro o grupo e coleto atualizações completas.\n\n*Como funciona:*\n1️⃣ Mencione algo sobre um projeto\n2️⃣ Peço detalhes: data, resultado, próximo passo\n3️⃣ Responda (texto ou foto)\n4️⃣ Mostro resumo → confirme\n\n💡 Perguntas e conversas casuais são ignoradas.\n\n/projetos — ver projetos`, msg.message_id);
  } else if (cmd === "/projetos") {
    await sendTG(msg.chat.id, `📋 *Projetos:*\n\n• ${PROJECTS}`, msg.message_id);
  }
}
