// Policontrol Bot v4 — Claude AI + Evidências obrigatórias
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

// ========== HANDLER ==========
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(200).send("Bot Policontrol v4 ativo");
  const update = req.body;
  try {
    if (update.callback_query) { await handleCallback(update.callback_query); return res.status(200).send("OK"); }
    const msg = update.message;
    if (!msg) return res.status(200).send("OK");

    // Foto (com ou sem reply)
    if (msg.photo) { await handlePhoto(msg); return res.status(200).send("OK"); }
    // Documento/arquivo
    if (msg.document) { await handleDoc(msg); return res.status(200).send("OK"); }

    if (!msg.text) return res.status(200).send("OK");
    if (msg.text.startsWith("/")) { await handleCommand(msg); return res.status(200).send("OK"); }

    // Reply ao bot
    if (msg.reply_to_message && String(msg.reply_to_message.from?.id) === TELEGRAM_TOKEN.split(":")[0]) {
      await handleReply(msg);
      return res.status(200).send("OK");
    }

    await classifyMessage(msg);
  } catch (e) { console.error("Error:", e.message); }
  return res.status(200).send("OK");
}

// ========== CLASSIFICAR ==========
async function classifyMessage(msg) {
  if (msg.text.length < 8) return;
  const userName = msg.from?.first_name || "Alguém";

  const sysPrompt = `Analise mensagem de grupo Policontrol. Projetos:\n• ${PROJECTS}

CLASSIFIQUE (JSON puro):
- Conversa casual/pergunta/opinião → {"type":"skip"}
- FATO concreto sobre projeto → {"type":"update","project":"nome","category":"shipping|testing|development|approval|purchase|other","whatDid":"o que fez"}

Categorias:
- "shipping": enviou, mandou, despachou peças/componentes/material
- "testing": testou, validou, mediu, analisou, resultado de teste
- "development": desenvolveu, programou, montou, projetou
- "approval": aprovou, liberou, homologou
- "purchase": comprou, recebeu compra, orçamento
- "other": qualquer outro fato concreto`;

  try {
    const raw = await callClaude(sysPrompt, `${userName}: "${msg.text}"`);
    const result = JSON.parse(raw);
    if (result.type === "skip") return;

    // Montar perguntas baseadas na CATEGORIA
    let askPrompt = `Alguém atualizou o projeto "${result.project}": "${msg.text}"
Categoria: ${result.category}

Gere UMA mensagem pedindo o que falta. REGRAS POR CATEGORIA:

`;
    if (result.category === "shipping") {
      askPrompt += `ENVIO — pergunte:
- 📅 Data do envio
- 📦 Número de rastreio (se tiver)
- 📷 Pedir foto do comprovante de envio
- ⏰ Previsão de entrega
- ⚡ Próximo passo após entrega
Diga: "Se tiver, manda foto do comprovante ou número de rastreio"`;
    } else if (result.category === "testing") {
      askPrompt += `TESTE — OBRIGATÓRIO pedir evidência! Pergunte:
- 📅 Data do teste
- 🔬 OBRIGATÓRIO: Dados de leitura, resultados, ou foto do teste (sem isso não registro!)
- ✅ Passou ou não? Qual critério?
- ⚡ Próximo passo
Deixe claro: "Preciso dos dados do teste (leituras, fotos, laudo) para registrar. Sem evidência não consigo validar."`;
    } else if (result.category === "approval") {
      askPrompt += `APROVAÇÃO — pergunte:
- 📅 Data da aprovação
- 👤 Quem aprovou?
- 📄 Tem documento/email de aprovação? Manda foto ou encaminha
- ⚡ Próximo passo`;
    } else if (result.category === "purchase") {
      askPrompt += `COMPRA — pergunte:
- 📅 Data da compra
- 💰 Valor (se relevante)
- 📦 Previsão de entrega
- 📄 Tem nota/comprovante? Manda foto
- ⚡ Próximo passo`;
    } else {
      askPrompt += `GERAL — pergunte:
- 📅 Data
- ⏰ Previsão do próximo passo
- ⚡ Próximo passo
- 📷 Se tiver foto ou documento, manda junto`;
    }

    askPrompt += `\n\nComece com "📋 *${result.project}* — anotei, ${userName}!" + o que entendeu + peça o que falta. Máx 5 linhas. Texto direto, não JSON.`;

    const followUp = await callClaude(askPrompt, msg.text);
    await sendTG(msg.chat.id, followUp, msg.message_id);
  } catch (e) { console.error("Classify:", e.message); }
}

// ========== REPLY ==========
async function handleReply(msg) {
  const userName = msg.from?.first_name || "Alguém";
  const botQuestion = msg.reply_to_message.text || "";
  const originalMsg = msg.reply_to_message.reply_to_message?.text || "";

  // Detectar categoria pelo contexto do bot
  const isTestContext = /teste|leitura|resultado|análise|medição|validação|evidência/i.test(botQuestion);
  const isShipContext = /envio|rastreio|comprovante|despacho|entrega/i.test(botQuestion);

  const sysPrompt = `Compile atualização de projeto Policontrol.

Contexto:
- Original: "${originalMsg}"
- Bot perguntou: "${botQuestion}"
- Resposta: "${msg.text}"
- Tem foto anexa: NÃO

${isTestContext ? "⚠ CONTEXTO DE TESTE: Se não enviou dados/fotos/leituras, marque evidenceOk=false e insista!" : ""}
${isShipContext ? "📦 CONTEXTO DE ENVIO: Se não enviou rastreio/foto, aceite mas registre como pendente." : ""}

Retorne JSON:
{
  "project": "nome",
  "summary": {
    "action": "o que fez",
    "date": "quando",
    "evidence": "dados/rastreio/comprovante ou 'pendente'",
    "nextStep": "próximo passo",
    "deadline": "previsão"
  },
  "evidenceOk": true/false,
  "complete": true/false,
  "followUp": "se incompleto ou sem evidência obrigatória, pergunta. Se completo, null"
}

Se evidenceOk=false em contexto de TESTE, NÃO marque complete=true. Testes PRECISAM de evidência.
Para envios, se não tem rastreio/foto, aceite mas coloque evidence="Comprovante pendente".`;

  try {
    const raw = await callClaude(sysPrompt, `${userName}: "${msg.text}"`);
    const result = JSON.parse(raw);

    if (!result.complete && result.followUp) {
      await sendTG(msg.chat.id, `${result.followUp}`, msg.message_id);
      return;
    }

    const s = result.summary;
    let text = `📋 *Atualização: ${result.project}*\n\n`;
    text += `✅ *O quê:* ${s.action}\n`;
    text += `📅 *Quando:* ${s.date}\n`;
    if (s.evidence) text += `🔬 *Evidência:* ${s.evidence}\n`;
    text += `⚡ *Próximo:* ${s.nextStep}\n`;
    text += `⏰ *Previsão:* ${s.deadline}\n`;
    if (!result.evidenceOk) text += `\n⚠️ _Evidência pendente_\n`;
    text += `\n👤 _${userName}_\n\n_Registro no sistema?_`;

    await sendTG(msg.chat.id, text, msg.message_id, [[
      { text: "✅ Registrar", callback_data: "reg" },
      { text: "❌ Descartar", callback_data: "del" }
    ]]);
  } catch (e) { console.error("Reply:", e.message); }
}

// ========== FOTO ==========
async function handlePhoto(msg) {
  const userName = msg.from?.first_name || "Alguém";
  const caption = msg.caption || "";
  const isReply = msg.reply_to_message && String(msg.reply_to_message.from?.id) === TELEGRAM_TOKEN.split(":")[0];

  if (isReply) {
    // Foto como resposta ao bot = evidência
    const botQuestion = msg.reply_to_message.text || "";

    const sysPrompt = `O usuário enviou uma FOTO como evidência para um projeto Policontrol.
Contexto do bot: "${botQuestion}"
Legenda da foto: "${caption}"

Compile o que temos e retorne JSON:
{
  "project": "nome do projeto (extraia do contexto)",
  "summary": {
    "action": "ação original",
    "date": "data se mencionada",
    "evidence": "📷 Foto enviada${caption ? ' — ' + caption : ''}",
    "nextStep": "próximo passo ou 'a definir'",
    "deadline": "previsão ou 'a definir'"
  }
}`;

    try {
      const raw = await callClaude(sysPrompt, `Foto de ${userName}. Legenda: "${caption || 'sem legenda'}"`);
      const result = JSON.parse(raw);
      const s = result.summary;

      let text = `📋 *Atualização: ${result.project}*\n\n`;
      text += `✅ *O quê:* ${s.action}\n`;
      if (s.date) text += `📅 *Quando:* ${s.date}\n`;
      text += `📷 *Evidência:* Foto recebida${caption ? ' — ' + caption : ''}\n`;
      text += `⚡ *Próximo:* ${s.nextStep}\n`;
      text += `⏰ *Previsão:* ${s.deadline}\n`;
      text += `\n👤 _${userName}_\n\n_Registro no sistema?_`;

      await sendTG(msg.chat.id, text, msg.message_id, [[
        { text: "✅ Registrar", callback_data: "reg" },
        { text: "❌ Descartar", callback_data: "del" }
      ]]);
    } catch (e) {
      await sendTG(msg.chat.id, `📷 *Foto recebida!* Registrei como evidência, ${userName}.`, msg.message_id);
      console.error("Photo:", e.message);
    }
  } else {
    // Foto solta no grupo — ignorar ou detectar contexto
    if (caption && caption.length > 10) {
      // Foto com legenda longa = possível atualização
      await classifyMessage({ ...msg, text: caption });
    }
  }
}

// ========== DOCUMENTO ==========
async function handleDoc(msg) {
  const caption = msg.caption || "";
  const fileName = msg.document?.file_name || "";
  const userName = msg.from?.first_name || "Alguém";

  if (msg.reply_to_message && String(msg.reply_to_message.from?.id) === TELEGRAM_TOKEN.split(":")[0]) {
    await sendTG(msg.chat.id, `📄 *Documento recebido!* _${fileName}_\nRegistrei como evidência, ${userName}.`, msg.message_id);
  }
}

// ========== CALLBACKS ==========
async function handleCallback(cb) {
  const chatId = cb.message?.chat?.id, msgId = cb.message?.message_id, text = cb.message?.text || "";
  if (cb.data === "reg") {
    await editTG(chatId, msgId, text.replace("_Registro no sistema?_", "✅ *REGISTRADO*"));
    console.log("[REG]", text.substring(0, 120));
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
    await sendTG(msg.chat.id, `🤖 *Bot Policontrol Projetos v4*\n\nMonitoro o grupo e coleto atualizações completas.\n\n*Regras de evidência:*\n🔬 *Testes:* OBRIGATÓRIO enviar dados, leituras ou fotos\n📦 *Envios:* Peço rastreio ou foto do comprovante\n📄 *Aprovações:* Peço documento ou email\n🛒 *Compras:* Peço nota ou comprovante\n\n*Como usar:*\n1️⃣ Mencione algo sobre um projeto\n2️⃣ Eu peço detalhes e evidências\n3️⃣ Responda com *reply* (segure minha mensagem → responder)\n4️⃣ Mande fotos/docs como evidência\n5️⃣ Confirme → ✅ registrado\n\n/projetos — ver projetos`, msg.message_id);
  } else if (cmd === "/projetos") {
    await sendTG(msg.chat.id, `📋 *Projetos:*\n\n• ${PROJECTS}`, msg.message_id);
  }
}
