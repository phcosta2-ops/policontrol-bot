// Policontrol Bot — Vercel Serverless (api/webhook.js)
// Webhook-based: Telegram chama esta função a cada mensagem

const TELEGRAM_TOKEN = "8619850108:AAFk2alsfSQLocua9jPOkzgUD33XPFsIrdc";
const GEMINI_KEY = "AIzaSyAe8ZRTH1dnDpIuWDLRp5cm8fpW409f5Hk";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`;
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

// ========== HELPERS ==========
async function callGemini(sysPrompt, userMsg) {
  const res = await fetch(GEMINI_URL, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: userMsg }] }], systemInstruction: { parts: [{ text: sysPrompt }] }, generationConfig: { temperature: 0.3 } })
  });
  const d = await res.json();
  if (d.error) throw new Error(d.error.message);
  return (d.candidates?.[0]?.content?.parts?.[0]?.text || "").replace(/```json|```/g, "").trim();
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

// ========== MAIN HANDLER ==========
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(200).send("OK");

  const update = req.body;

  try {
    // Callback (botões)
    if (update.callback_query) {
      await handleCallback(update.callback_query);
      return res.status(200).send("OK");
    }

    const msg = update.message;
    if (!msg) return res.status(200).send("OK");

    // Foto durante entrevista
    if (msg.photo && msg.reply_to_message) {
      await handlePhotoReply(msg);
      return res.status(200).send("OK");
    }

    if (!msg.text) return res.status(200).send("OK");

    // Comandos
    if (msg.text.startsWith("/")) {
      await handleCommand(msg);
      return res.status(200).send("OK");
    }

    // Reply ao bot = resposta de entrevista
    if (msg.reply_to_message && String(msg.reply_to_message.from?.id) === TELEGRAM_TOKEN.split(":")[0]) {
      await handleReplyToBot(msg);
      return res.status(200).send("OK");
    }

    // Mensagem normal = classificar
    await classifyMessage(msg);

  } catch (e) {
    console.error("Error:", e.message);
  }

  return res.status(200).send("OK");
}

// ========== CLASSIFICAR MENSAGEM ==========
async function classifyMessage(msg) {
  if (msg.text.length < 8) return;
  const userName = msg.from?.first_name || "Alguém";

  const sysPrompt = `Analise mensagem de grupo Policontrol.

PROJETOS:
• ${PROJECTS}

CLASSIFIQUE (JSON puro):
- Conversa casual → {"type":"skip"}
- Pergunta sobre projeto → {"type":"skip"}  
- Discussão/opinião → {"type":"skip"}
- FATO concreto sobre projeto (enviou, recebeu, testou, aprovou, comprou, montou) →
  {"type":"update","project":"nome","whatDid":"o que fez","missingInfo":"lista do que falta: data? previsão próximo passo? resultado/evidência? próximo passo?"}

"Mandei pro Fiore" = update (fato)
"Acho que devíamos testar" = skip (opinião)
"Como tá o MPN?" = skip (pergunta)`;

  try {
    const raw = await callGemini(sysPrompt, `${userName}: "${msg.text}"`);
    const result = JSON.parse(raw);
    if (result.type === "skip") return;

    // Detectou atualização — perguntar o que falta
    const askPrompt = `Alguém deu uma atualização parcial sobre o projeto "${result.project}":
"${msg.text}"

O que foi dito: ${result.whatDid}
O que falta: ${result.missingInfo}

Gere UMA mensagem curta, direta e simpática pedindo as informações que faltam.
A mensagem deve cobrar:
- 📅 Data que foi feito (se não disse)
- ⏰ Previsão de quando o próximo passo fica pronto
- 🔬 Resultado/evidência (se faz sentido pedir — teste precisa de dados, envio precisa de comprovante/foto, etc)
- ⚡ Qual o próximo passo

NÃO peça o que já foi dito. Seja direto mas educado. Máximo 4 linhas.
Comece com "📋 *${result.project}* — anotei, ${userName}!" seguido de uma linha com o que entendeu, depois peça o que falta.

Retorne APENAS o texto da mensagem (não JSON).`;

    const followUp = await callGemini(askPrompt, msg.text);
    await sendTG(msg.chat.id, followUp, msg.message_id);

  } catch (e) { console.error("Classify:", e.message); }
}

// ========== REPLY AO BOT (resposta da entrevista) ==========
async function handleReplyToBot(msg) {
  const userName = msg.from?.first_name || "Alguém";
  const botQuestion = msg.reply_to_message.text || "";
  const originalMsg = msg.reply_to_message.reply_to_message?.text || "";

  const sysPrompt = `Você é gestor de projetos da Policontrol compilando uma atualização.

CONTEXTO:
- Mensagem original: "${originalMsg}"
- Bot perguntou: "${botQuestion}"  
- Pessoa respondeu: "${msg.text}"

PROJETOS: • ${PROJECTS}

Compile TUDO em uma atualização completa. Retorne JSON:
{
  "project": "nome do projeto",
  "complete": true/false,
  "summary": {
    "action": "o que foi feito",
    "date": "quando (ou 'não informado')",
    "evidence": "resultado/evidência (ou 'não informado')",
    "nextStep": "próximo passo (ou 'não informado')",
    "deadline": "previsão (ou 'não informado')"
  },
  "followUp": "se complete=false, pergunta o que ainda falta (texto direto). Se complete=true, null"
}

Se a pessoa disse "não sei" ou "ainda não tem" para algo, aceite e marque como "a definir". Considere complete=true.
Não insista demais — se já tem ação + pelo menos 1 dado extra (data OU próximo passo), considere complete.`;

  try {
    const raw = await callGemini(sysPrompt, `Resposta de ${userName}: "${msg.text}"`);
    const result = JSON.parse(raw);

    if (!result.complete && result.followUp) {
      // Ainda falta info — pergunta mais (máx 1 rodada extra)
      await sendTG(msg.chat.id, `👍 Anotei!\n\n${result.followUp}`, msg.message_id);
      return;
    }

    // Completo — mostra resumo e pede confirmação
    const s = result.summary;
    let text = `📋 *Atualização: ${result.project}*\n\n`;
    text += `✅ *O quê:* ${s.action}\n`;
    text += `📅 *Quando:* ${s.date}\n`;
    if (s.evidence && s.evidence !== "não informado") text += `🔬 *Evidência:* ${s.evidence}\n`;
    text += `⚡ *Próximo:* ${s.nextStep}\n`;
    text += `⏰ *Previsão:* ${s.deadline}\n`;
    text += `\n👤 _${userName}_\n\n_Registro no sistema?_`;

    await sendTG(msg.chat.id, text, msg.message_id, [[
      { text: "✅ Registrar", callback_data: "reg" },
      { text: "❌ Descartar", callback_data: "del" }
    ]]);

  } catch (e) { console.error("Reply:", e.message); }
}

// ========== FOTO ==========
async function handlePhotoReply(msg) {
  const caption = msg.caption || "Foto/evidência enviada";
  await sendTG(msg.chat.id, `📷 *Foto recebida!* Registrei como evidência.\n_${caption}_`, msg.message_id);
}

// ========== CALLBACKS (botões) ==========
async function handleCallback(cb) {
  const chatId = cb.message?.chat?.id;
  const msgId = cb.message?.message_id;
  const text = cb.message?.text || "";

  if (cb.data === "reg") {
    await editTG(chatId, msgId, text.replace("_Registro no sistema?_", "✅ *REGISTRADO*"));
    console.log("[REGISTRADO]", text.substring(0, 100));
  } else if (cb.data === "del") {
    await editTG(chatId, msgId, "❌ _Descartado._");
  }

  await fetch(`${TG_API}/answerCallbackQuery`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: cb.id }) });
}

// ========== COMANDOS ==========
async function handleCommand(msg) {
  const cmd = msg.text?.split("@")[0];

  if (cmd === "/start") {
    await sendTG(msg.chat.id, `🤖 *Bot Policontrol Projetos*\n\nMonitoro o grupo e coleto atualizações completas.\n\n*Como funciona:*\n1️⃣ Alguém menciona algo sobre um projeto\n2️⃣ Eu peço detalhes: data, resultado, próximo passo\n3️⃣ A pessoa responde (texto ou foto)\n4️⃣ Mostro resumo e peço confirmação\n5️⃣ ✅ → registrado\n\n💡 Perguntas e conversas casuais são ignoradas.\n\n/projetos — ver projetos\n/ensinar — me ensina contexto`, msg.message_id);
  }
  else if (cmd === "/projetos") {
    await sendTG(msg.chat.id, `📋 *Projetos monitorados:*\n\n• ${PROJECTS}`, msg.message_id);
  }
  else if (cmd === "/ensinar") {
    await sendTG(msg.chat.id, `📚 *Me ensine!* Responda esta mensagem.\n\nEx:\n_"Fiore testa placas do Medidor de Cloro"_\n_"Firmware = PoliSealer"_\n_"Maurício = eletrônica"_`, msg.message_id);
  }
}
