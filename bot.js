// Policontrol Projetos - Telegram Bot v3
// Entrevistador inteligente: pede dados completos antes de registrar

const TELEGRAM_TOKEN = "8619850108:AAFk2alsfSQLocua9jPOkzgUD33XPFsIrdc";
const GEMINI_KEY = "AIzaSyAe8ZRTH1dnDpIuWDLRp5cm8fpW409f5Hk";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`;
const TG_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

const PROJECTS = [
  { id:"p04", name:"Placa AP2000 (024/2024)", area:"Des. Industrial", keywords:["ap2000","placa processadora","turbidímetro"] },
  { id:"p05", name:"FlocControl Display (002/2025)", area:"Des. Industrial", keywords:["floccontrol","display","retroiluminado"] },
  { id:"p06", name:"MPN Reader (005/2025)", area:"Des. Industrial", keywords:["mpn","reader","idexx","cartela"] },
  { id:"p07", name:"Medidor Presença (006/2025)", area:"Des. Industrial", keywords:["presença","ausência","oxitop"] },
  { id:"p08", name:"AquaColor Flúor (007/2025)", area:"Des. Industrial", keywords:["aquacolor","flúor","led"] },
  { id:"p10", name:"CL Track Online (010/2025)", area:"Des. Industrial", keywords:["cl track","cloro online","analisador"] },
  { id:"p01", name:"Medidor Cloro Pocket (005/2021)", area:"Contratado", keywords:["cloro pocket","medidor cloro","fiore"] },
  { id:"p03", name:"Poli Sealer (014/2022)", area:"Contratado", keywords:["polisealer","sealer","unicorp","firmware"] },
  { id:"p02", name:"Dispenser Powder Pillow (009/2023)", area:"Contratado", keywords:["dispenser","powder pillow","victum","molde"] },
  { id:"p09", name:"OxiPoli (009/2025)", area:"Contratado", keywords:["oxipoli","sensor pressão","agitadora"] },
  { id:"p11", name:"Monitor Coagulante", area:"Contratado", keywords:["coagulante","aegea"] },
  { id:"p12", name:"Poli Viewer", area:"Des. Industrial", keywords:["viewer","gabinete"] },
  { id:"p13", name:"Reagente Cloro Online (039/2022)", area:"Des. Químico", keywords:["cloro online","blue-i","kit 4"] },
  { id:"p14", name:"Alumínio Hach (004/2023)", area:"Des. Químico", keywords:["alumínio","hach","clone"] },
  { id:"p15", name:"Reagente Manganês (001/2024)", area:"Des. Químico", keywords:["manganês"] },
  { id:"p16", name:"Cloro DPD Pastilha (010/2024)", area:"Des. Químico", keywords:["pastilha","dpd pastilha"] },
  { id:"p17", name:"Padrão NTU Hach (014/2024)", area:"Des. Químico", keywords:["ntu","padrão ntu"] },
  { id:"p21", name:"Stabgel Cloro (008/2025)", area:"Des. Químico", keywords:["stabgel"] },
  { id:"p22", name:"Nitrogênio Total (011/2025)", area:"Des. Químico", keywords:["nitrogênio"] },
  { id:"pq10", name:"Fósforo Total (012/2025)", area:"Des. Químico", keywords:["fósforo"] },
  { id:"pq17", name:"Padrão DQO (006/2026)", area:"Des. Químico", keywords:["dqo"] },
];

let learnings = [];

// Conversas ativas: { oderId: { project, collected, missing, botMsgId, userName, history, expiresAt } }
const activeChats = {};

const projectsCtx = PROJECTS.map(p => `• "${p.name}" [${p.area}] (termos: ${p.keywords.join(", ")})`).join("\n");

// ========== GEMINI ==========
async function callGemini(sysPrompt, userMsg) {
  const res = await fetch(GEMINI_URL, { method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ contents:[{parts:[{text:userMsg}]}], systemInstruction:{parts:[{text:sysPrompt}]}, generationConfig:{temperature:0.3} })
  });
  const d = await res.json();
  if (d.error) throw new Error(d.error.message);
  return (d.candidates?.[0]?.content?.parts?.[0]?.text||"").replace(/```json|```/g,"").trim();
}

// ========== TELEGRAM ==========
async function sendTG(chatId, text, replyTo, buttons) {
  const body = { chat_id:chatId, text, parse_mode:"Markdown", reply_to_message_id:replyTo };
  if (buttons) body.reply_markup = JSON.stringify({inline_keyboard:buttons});
  const res = await fetch(`${TG_API}/sendMessage`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body) });
  const data = await res.json();
  return data.result?.message_id;
}

async function editTG(chatId, msgId, text, buttons) {
  const body = { chat_id:chatId, message_id:msgId, text, parse_mode:"Markdown" };
  if (buttons) body.reply_markup = JSON.stringify({inline_keyboard:buttons});
  await fetch(`${TG_API}/editMessageText`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body) });
}

// ========== CLASSIFICAÇÃO INICIAL ==========
async function classifyMessage(msg) {
  const text = msg.text;
  if (!text || text.length < 8) return;
  const userName = msg.from?.first_name || "Alguém";
  const userId = msg.from?.id;

  // Se já tem conversa ativa com esse usuário, trata como resposta
  const activeKey = findActiveChat(userId, msg.chat.id);
  if (activeKey) {
    await handleFollowUp(activeKey, msg);
    return;
  }

  const learningsCtx = learnings.length ? `\nCONHECIMENTO:\n${learnings.map(l=>`• ${l}`).join("\n")}` : "";

  const sysPrompt = `Analise mensagem de grupo da Policontrol.

PROJETOS:
${projectsCtx}${learningsCtx}

CLASSIFIQUE e retorne JSON:

1. Sem relação com projetos → {"type":"irrelevant"}
2. Pergunta sobre projeto → {"type":"question","project":"nome"}  
3. Discussão/opinião → {"type":"discussion","project":"nome"}
4. Informação sobre projeto (envio, teste, resultado, decisão, problema) → {"type":"update","project":"nome","whatWasSaid":"resumo do que foi dito"}

Mesmo informações parciais ou vagas são "update" se contém um FATO sobre um projeto.
"Já enviei pro Fiore" = update (fato: algo foi enviado)
"Acho que devíamos testar" = discussion (opinião)
"Como tá o MPN?" = question`;

  try {
    const raw = await callGemini(sysPrompt, `${userName}: "${text}"`);
    const result = JSON.parse(raw);

    if (result.type === "irrelevant" || result.type === "question" || result.type === "discussion") {
      if (result.type !== "irrelevant") console.log(`[${result.type}] ${result.project}`);
      return;
    }

    if (result.type === "update") {
      await startInterview(msg, result, userName, userId);
    }
  } catch(e) { console.error("Classify:", e.message); }
}

// ========== ENTREVISTA ==========
async function startInterview(msg, classification, userName, userId) {
  const chatId = msg.chat.id;

  // Pede pra IA analisar o que falta
  const sysPrompt = `Você é um gestor de projetos exigente. Alguém deu uma atualização sobre o projeto "${classification.project}":

"${msg.text}"

Analise o que foi dito e identifique o que FALTA para ser uma atualização completa. 

Uma atualização completa precisa de:
1. O QUE foi feito (ação concreta) ✓ ou ✗
2. QUANDO foi feito (data) ✓ ou ✗
3. RESULTADO/EVIDÊNCIA (dados de teste, leitura, foto, aprovação) ✓ ou ✗ — se aplicável
4. PRÓXIMO PASSO (o que vem agora) ✓ ou ✗
5. PREVISÃO (quando o próximo passo fica pronto) ✓ ou ✗

Retorne JSON:
{
  "collected": {
    "action": "o que foi feito, ou null",
    "date": "quando, ou null", 
    "evidence": "resultado/dado, ou null",
    "nextStep": "próximo passo, ou null",
    "deadline": "previsão próximo passo, ou null"
  },
  "missing": ["lista do que falta perguntar"],
  "followUpQuestion": "pergunta simpática mas direta pedindo o que falta (máx 2 itens por vez)"
}

Seja direto e prático. Se já tem tudo, "missing" vem vazio.
Não peça evidência quando não faz sentido (ex: compra de componente não precisa de foto).`;

  try {
    const raw = await callGemini(sysPrompt, msg.text);
    const analysis = JSON.parse(raw);

    const key = `${chatId}_${userId}`;
    activeChats[key] = {
      project: classification.project,
      collected: analysis.collected,
      missing: analysis.missing,
      history: [msg.text],
      userName,
      userId,
      chatId,
      originalMsgId: msg.message_id,
      expiresAt: Date.now() + 15 * 60 * 1000 // 15 min
    };

    if (analysis.missing.length === 0) {
      // Já tem tudo! Mostra resumo direto
      await showSummary(key);
    } else {
      // Pede mais info
      let reply = `📋 *${classification.project}* — entendi, ${userName}!\n\n`;
      reply += `✅ _${analysis.collected.action || msg.text}_\n\n`;
      reply += `Mas preciso de mais detalhes:\n\n`;
      reply += `💬 *${analysis.followUpQuestion}*`;

      const botMsgId = await sendTG(chatId, reply, msg.message_id);
      activeChats[key].botMsgId = botMsgId;
    }
  } catch(e) { console.error("Interview:", e.message); }
}

// ========== FOLLOW-UP ==========
async function handleFollowUp(key, msg) {
  const chat = activeChats[key];
  chat.history.push(msg.text);
  chat.expiresAt = Date.now() + 15 * 60 * 1000; // Renova tempo

  // Manda toda conversa pro Gemini re-analisar
  const fullConversation = chat.history.join("\n---\n");

  const sysPrompt = `Você é gestor de projetos. Está coletando atualização sobre "${chat.project}".

Já coletou:
${JSON.stringify(chat.collected, null, 2)}

Faltava: ${chat.missing.join(", ")}

A pessoa respondeu com mais informações. Re-analise TUDO e retorne JSON:

{
  "collected": {
    "action": "o que foi feito",
    "date": "quando (DD/MM/YYYY se possível)", 
    "evidence": "resultado/dado/evidência ou null",
    "nextStep": "próximo passo ou null",
    "deadline": "previsão DD/MM/YYYY ou null"
  },
  "missing": ["o que AINDA falta — lista vazia se já tem o suficiente"],
  "followUpQuestion": "próxima pergunta, ou null se já completo"
}

Se a pessoa disse algo como "não sei" ou "não tem" para algum item, aceite e marque como "N/A".
Não insista mais de 2 rodadas no mesmo item. Seja prático.`;

  try {
    const raw = await callGemini(sysPrompt, `Conversa até agora:\n${fullConversation}`);
    const analysis = JSON.parse(raw);

    chat.collected = analysis.collected;
    chat.missing = analysis.missing;

    if (analysis.missing.length === 0 || chat.history.length >= 5) {
      // Completo ou já perguntou demais — mostra resumo
      await showSummary(key);
    } else {
      // Pede mais
      let reply = `👍 Anotei!\n\n💬 *${analysis.followUpQuestion}*`;
      await sendTG(chat.chatId, reply, msg.message_id);
    }
  } catch(e) { 
    console.error("FollowUp:", e.message);
    await showSummary(key); // Em caso de erro, registra o que tem
  }
}

// ========== RESUMO E CONFIRMAÇÃO ==========
async function showSummary(key) {
  const chat = activeChats[key];
  const c = chat.collected;

  let summary = `📋 *Atualização completa — ${chat.project}*\n\n`;
  if (c.action) summary += `✅ *O quê:* ${c.action}\n`;
  if (c.date) summary += `📅 *Quando:* ${c.date}\n`;
  if (c.evidence) summary += `🔬 *Evidência:* ${c.evidence}\n`;
  if (c.nextStep) summary += `⚡ *Próximo passo:* ${c.nextStep}\n`;
  if (c.deadline) summary += `⏰ *Previsão:* ${c.deadline}\n`;
  summary += `\n👤 _${chat.userName}_`;
  summary += `\n\n_Tudo certo? Registro no sistema?_`;

  // Marca como aguardando confirmação
  chat.awaitingConfirm = true;

  await sendTG(chat.chatId, summary, chat.originalMsgId, [[
    { text: "✅ Registrar", callback_data: `reg_${key}` },
    { text: "❌ Descartar", callback_data: `del_${key}` },
    { text: "✏️ Corrigir", callback_data: `fix_${key}` }
  ]]);
}

// ========== BOTÕES ==========
async function handleCallback(cb) {
  const data = cb.data, chatId = cb.message?.chat?.id, msgId = cb.message?.message_id;

  if (data.startsWith("reg_")) {
    const key = data.replace("reg_","");
    const chat = activeChats[key];
    if (chat) {
      const c = chat.collected;
      let final = `✅ *Registrado!*\n\n`;
      final += `🏷 *${chat.project}*\n`;
      if (c.action) final += `📝 ${c.action}\n`;
      if (c.date) final += `📅 ${c.date}\n`;
      if (c.evidence) final += `🔬 ${c.evidence}\n`;
      if (c.nextStep) final += `⚡ Próximo: ${c.nextStep}\n`;
      if (c.deadline) final += `⏰ Previsão: ${c.deadline}\n`;
      final += `\n👤 _${chat.userName}_`;

      await editTG(chatId, msgId, final);
      console.log(`[REGISTRADO] ${chat.project}: ${c.action} | ${c.nextStep} | ${c.deadline} (${chat.userName})`);
      delete activeChats[key];
    }
  }
  else if (data.startsWith("del_")) {
    await editTG(chatId, msgId, "❌ _Descartado._");
    delete activeChats[data.replace("del_","")];
  }
  else if (data.startsWith("fix_")) {
    const key = data.replace("fix_","");
    const chat = activeChats[key];
    if (chat) {
      chat.awaitingConfirm = false;
      chat.history = []; // Reset pra re-coletar
      await editTG(chatId, msgId, `✏️ *${chat.userName}*, me conta de novo o que aconteceu com o *${chat.project}*. Vou re-coletar as informações.`);
    }
  }

  await fetch(`${TG_API}/answerCallbackQuery`, { method:"POST", headers:{"Content-Type":"application/json"},
    body:JSON.stringify({callback_query_id:cb.id}) });
}

// ========== HELPERS ==========
function findActiveChat(userId, chatId) {
  const key = `${chatId}_${userId}`;
  const chat = activeChats[key];
  if (chat && !chat.awaitingConfirm && chat.expiresAt > Date.now()) return key;
  return null;
}

// ========== COMANDOS ==========
async function handleCommand(msg) {
  const cmd = msg.text?.split("@")[0];
  if (cmd === "/start") {
    await sendTG(msg.chat.id, `🤖 *Bot Policontrol Projetos*\n\nMonitoro o grupo e coleto atualizações completas.\n\n*Como funciona:*\n1️⃣ Você menciona algo sobre um projeto\n2️⃣ Eu peço detalhes: data, resultado, próximo passo, previsão\n3️⃣ Você responde (pode ser por texto ou foto)\n4️⃣ Quando completo, mostro o resumo e peço confirmação\n5️⃣ Confirma → registro no sistema\n\n*Comandos:*\n/projetos — lista projetos\n/ensinar — me ensina contexto\n/aprendizados — o que já sei\n/cancelar — cancela entrevista ativa\n\n*${PROJECTS.length} projetos monitorados.*`, msg.message_id);
  }
  else if (cmd === "/projetos") {
    const byArea = {};
    PROJECTS.forEach(p => { byArea[p.area]=byArea[p.area]||[]; byArea[p.area].push(p.name); });
    let l = "📋 *Projetos:*\n";
    for (const [a,ps] of Object.entries(byArea)) { l += `\n*${a}:*\n`; ps.forEach(p => l += `  • ${p}\n`); }
    await sendTG(msg.chat.id, l, msg.message_id);
  }
  else if (cmd === "/ensinar") {
    await sendTG(msg.chat.id, `📚 *Me ensine algo!*\n\nResponda esta mensagem.\n\nExemplos:\n_"Fiore testa as placas do Medidor de Cloro"_\n_"Firmware sempre é sobre PoliSealer"_\n_"Maurício cuida da eletrônica"_\n_"Testes de reagente precisam de laudo de estabilidade"_`, msg.message_id);
  }
  else if (cmd === "/aprendizados") {
    await sendTG(msg.chat.id, learnings.length ? `📚 *${learnings.length} aprendizado(s):*\n\n${learnings.map((l,i)=>`${i+1}. ${l}`).join("\n")}` : "📚 _Nada ainda. Use /ensinar_", msg.message_id);
  }
  else if (cmd === "/esquecer") {
    learnings = [];
    await sendTG(msg.chat.id, "🗑 _Aprendizados limpos._", msg.message_id);
  }
  else if (cmd === "/cancelar") {
    const key = `${msg.chat.id}_${msg.from?.id}`;
    if (activeChats[key]) {
      delete activeChats[key];
      await sendTG(msg.chat.id, "🚫 _Entrevista cancelada._", msg.message_id);
    } else {
      await sendTG(msg.chat.id, "_Nenhuma entrevista ativa._", msg.message_id);
    }
  }
}

// ========== RESPOSTAS AO BOT (ensinar) ==========
async function handleReply(msg) {
  const replied = msg.reply_to_message;
  if (!replied || String(replied.from?.id) !== TELEGRAM_TOKEN.split(":")[0]) return false;
  const botText = replied.text || "";

  if (botText.includes("Me ensine")) {
    learnings.push(msg.text);
    await sendTG(msg.chat.id, `✅ *Aprendi!* _"${msg.text}"_\nTotal: ${learnings.length}`, msg.message_id);
    return true;
  }
  return false;
}

// ========== FOTOS ==========
async function handlePhoto(msg) {
  const userId = msg.from?.id;
  const key = `${msg.chat.id}_${userId}`;
  const chat = activeChats[key];
  if (!chat || chat.awaitingConfirm) return;

  // Tem conversa ativa — foto é evidência
  const caption = msg.caption || "Foto enviada como evidência";
  chat.collected.evidence = (chat.collected.evidence || "") + " | 📷 " + caption;
  chat.history.push(`[FOTO: ${caption}]`);

  await sendTG(msg.chat.id, `📷 *Foto recebida!* Anotei como evidência.\n\n_Continue respondendo ou aguarde o resumo._`, msg.message_id);

  // Re-analisa se já tem tudo
  if (chat.missing.length <= 1) {
    await showSummary(key);
  }
}

// ========== LOOP ==========
let offset = 0;
async function poll() {
  try {
    const res = await fetch(`${TG_API}/getUpdates?offset=${offset}&timeout=30&allowed_updates=["message","callback_query"]`);
    const data = await res.json();
    if (data.ok) for (const u of data.result) {
      offset = u.update_id + 1;

      if (u.callback_query) { await handleCallback(u.callback_query); continue; }

      const msg = u.message;
      if (!msg) continue;

      // Foto
      if (msg.photo) { await handlePhoto(msg); continue; }
      if (!msg.text) continue;

      // Comandos
      if (msg.text.startsWith("/")) { await handleCommand(msg); continue; }

      // Reply ao bot (ensinar)
      if (msg.reply_to_message) {
        const handled = await handleReply(msg);
        if (handled) continue;
      }

      // Mensagem normal
      await classifyMessage(msg);
    }
  } catch(e) { console.error("Poll:", e.message); await new Promise(r=>setTimeout(r,5000)); }

  // Limpa expirados
  const now = Date.now();
  for (const [k,v] of Object.entries(activeChats)) if (v.expiresAt < now) delete activeChats[k];
  poll();
}

console.log("🤖 Bot Policontrol v3 — Entrevistador Inteligente");
console.log(`📋 ${PROJECTS.length} projetos | Comandos: /start /projetos /ensinar /cancelar`);
poll();
