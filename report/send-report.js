// send-report.js — Envia relatório por email via Resend
const RESEND_KEY = process.env.RESEND_KEY;
const UPSTASH_URL = process.env.UPSTASH_URL || "https://smooth-dingo-93735.upstash.io";
const UPSTASH_TOKEN = process.env.UPSTASH_TOKEN || "";

const RECIPIENTS = [
  "rodrigo.costa@policontrol.com.br",
  "raphael.costa@policontrol.com.br"
];

const PROJECTS = [
  { name: "Placa AP2000 (024/2024)", area: "Des. Industrial", tipo: "Melhoria", status: "Atrasado", fase: "Desenvolvimento", previsao: "2026-05-30" },
  { name: "FlocControl Display (002/2025)", area: "Des. Industrial", tipo: "Melhoria", status: "Atrasado", fase: "Desenvolvimento", previsao: "2025-10-30" },
  { name: "MPN Reader (005/2025)", area: "Des. Industrial", tipo: "Melhoria", status: "Atrasado", fase: "Validação", previsao: "2025-12-06" },
  { name: "Medidor Presença (006/2025)", area: "Des. Industrial", tipo: "Novo Produto", status: "No prazo", fase: "Desenvolvimento", previsao: "2026-02-28" },
  { name: "AquaColor Flúor (007/2025)", area: "Des. Industrial", tipo: "Melhoria", status: "No prazo", fase: "Desenvolvimento", previsao: "2026-02-28" },
  { name: "CL Track Online (010/2025)", area: "Des. Industrial", tipo: "Novo Produto", status: "Atrasado", fase: "Ideação", previsao: "2026-01-30" },
  { name: "Poli Viewer", area: "Des. Industrial", tipo: "", status: "Em risco", fase: "Desenvolvimento", previsao: "" },
  { name: "Medidor Cloro Pocket (005/2021)", area: "Contratado", tipo: "Novo Produto", status: "Atrasado", fase: "Desenvolvimento", previsao: "2022-07-30" },
  { name: "Poli Sealer (014/2022)", area: "Contratado", tipo: "Novo Produto", status: "Atrasado", fase: "Testes", previsao: "2024-12-30" },
  { name: "Dispenser Powder Pillow (009/2023)", area: "Contratado", tipo: "Novo Produto", status: "Atrasado", fase: "Desenvolvimento", previsao: "2022-09-30" },
  { name: "OxiPoli (009/2025)", area: "Contratado", tipo: "Novo Produto", status: "No prazo", fase: "Testes", previsao: "2026-07-01" },
  { name: "Monitor Coagulante", area: "Contratado", tipo: "", status: "No prazo", fase: "Validação", previsao: "" },
  { name: "Reagente Cloro Online (039/2022)", area: "Des. Químico", tipo: "Novo Produto", status: "No prazo", fase: "Desenvolvimento", previsao: "2026-02-28" },
  { name: "Alumínio Hach (004/2023)", area: "Des. Químico", tipo: "Novo Produto", status: "No prazo", fase: "Desenvolvimento", previsao: "2025-12-30" },
  { name: "Reagente Manganês (001/2024)", area: "Des. Químico", tipo: "Novo Produto", status: "No prazo", fase: "Testes", previsao: "2026-03-30" },
  { name: "Cloro DPD Pastilha (010/2024)", area: "Des. Químico", tipo: "Novo Produto", status: "No prazo", fase: "Testes", previsao: "2026-03-30" },
  { name: "Padrão NTU Hach (014/2024)", area: "Des. Químico", tipo: "Novo Produto", status: "No prazo", fase: "Validação", previsao: "2026-05-30" },
  { name: "SPADNS sem arsenito (003/2025)", area: "Des. Químico", tipo: "Redução de Custo", status: "No prazo", fase: "Desenvolvimento", previsao: "2026-05-30" },
  { name: "SPADNS com arsenito (004/2025)", area: "Des. Químico", tipo: "Redução de Custo", status: "No prazo", fase: "Desenvolvimento", previsao: "2026-05-30" },
  { name: "Stabgel Cloro (008/2025)", area: "Des. Químico", tipo: "Novo Produto", status: "No prazo", fase: "Desenvolvimento", previsao: "2026-09-29" },
  { name: "Nitrogênio Total (011/2025)", area: "Des. Químico", tipo: "Novo Produto", status: "Parado", fase: "Ideação", previsao: "2027-03-30" },
  { name: "Fósforo Total (012/2025)", area: "Des. Químico", tipo: "Novo Produto", status: "No prazo", fase: "Ideação", previsao: "2027-03-30" },
  { name: "Cloro DPD Sachê China (013/2025)", area: "Des. Químico", tipo: "Redução de Custo", status: "No prazo", fase: "Desenvolvimento", previsao: "2026-03-31" },
  { name: "Cloro DPD Sachê Shaanxi (001/2026)", area: "Des. Químico", tipo: "Redução de Custo", status: "No prazo", fase: "Desenvolvimento", previsao: "2026-04-30" },
  { name: "Reagente DPD Total Pó Online (002/2026)", area: "Des. Químico", tipo: "Novo Produto", status: "No prazo", fase: "Desenvolvimento", previsao: "2026-08-02" },
  { name: "Padrão DQO 1000 mg/L (006/2026)", area: "Des. Químico", tipo: "Melhoria", status: "No prazo", fase: "Desenvolvimento", previsao: "2026-11-30" },
  { name: "Reagente DPD Líquido China (007/2026)", area: "Des. Químico", tipo: "Redução de Custo", status: "No prazo", fase: "Desenvolvimento", previsao: "2026-07-30" },
];

function calcDesl(previsao) {
  if (!previsao) return null;
  const diff = Math.ceil((new Date(previsao + "T00:00:00") - new Date()) / 864e5);
  return diff < 0 ? Math.abs(diff) : 0;
}

async function getRecentUpdates() {
  try {
    const res = await fetch(`${UPSTASH_URL}/lrange/poli-telegram-updates/0/9`, {
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
    });
    const d = await res.json();
    if (!d.result) return [];
    return d.result.map(raw => { try { return JSON.parse(raw); } catch(e) { return null; } }).filter(Boolean);
  } catch(e) { return []; }
}

async function sendEmail(subject, html) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_KEY}` },
    body: JSON.stringify({
      from: "Policontrol Projetos <onboarding@resend.dev>",
      to: RECIPIENTS,
      subject,
      html
    })
  });
  const data = await res.json();
  console.log("Email sent:", data);
  return data;
}

async function main() {
  const today = new Date().toLocaleDateString("pt-BR");
  const updates = await getRecentUpdates();

  const total = PROJECTS.length;
  const noPrazo = PROJECTS.filter(p => p.status === "No prazo").length;
  const atrasados = PROJECTS.filter(p => p.status === "Atrasado").length;
  const emRisco = PROJECTS.filter(p => p.status === "Em risco").length;
  const parados = PROJECTS.filter(p => p.status === "Parado").length;

  const areas = [
    { name: "Des. Industrial", icon: "🏭", color: "#007AFF" },
    { name: "Contratado", icon: "🤝", color: "#AF52DE" },
    { name: "Des. Químico", icon: "🧪", color: "#34C759" },
  ];

  // Build HTML email
  let html = `
  <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:700px;margin:0 auto;background:#fff;">
    <!-- Header -->
    <div style="background:linear-gradient(135deg,#007AFF,#0055CC);padding:30px;text-align:center;border-radius:12px 12px 0 0;">
      <h1 style="color:#fff;margin:0;font-size:24px;">📊 Relatório de Projetos</h1>
      <p style="color:rgba(255,255,255,0.8);margin:8px 0 0;font-size:14px;">Policontrol — ${today}</p>
    </div>

    <!-- KPI Cards -->
    <div style="padding:20px;background:#F8F9FA;">
      <table width="100%" cellpadding="0" cellspacing="8" style="border-collapse:separate;">
        <tr>
          <td style="background:#fff;border-radius:10px;padding:16px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
            <div style="font-size:32px;font-weight:700;color:#007AFF;">${total}</div>
            <div style="font-size:11px;color:#86868B;font-weight:600;">TOTAL</div>
          </td>
          <td style="background:#fff;border-radius:10px;padding:16px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
            <div style="font-size:32px;font-weight:700;color:#34C759;">${noPrazo}</div>
            <div style="font-size:11px;color:#86868B;font-weight:600;">NO PRAZO</div>
          </td>
          <td style="background:#fff;border-radius:10px;padding:16px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
            <div style="font-size:32px;font-weight:700;color:#E8363C;">${atrasados}</div>
            <div style="font-size:11px;color:#86868B;font-weight:600;">ATRASADOS</div>
          </td>
          <td style="background:#fff;border-radius:10px;padding:16px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
            <div style="font-size:32px;font-weight:700;color:#FF9500;">${emRisco + parados}</div>
            <div style="font-size:11px;color:#86868B;font-weight:600;">RISCO/PARADO</div>
          </td>
        </tr>
      </table>
    </div>

    <!-- Metas Semestre -->
    <div style="padding:0 20px 20px;">
      <h2 style="font-size:16px;color:#1D1D1F;margin:0 0 12px;">🎯 Metas do Semestre (≥2 por tipo)</h2>
      <table width="100%" cellpadding="0" cellspacing="8" style="border-collapse:separate;">
        ${areas.filter(a => a.name !== "Contratado").map(a => {
          const ps = PROJECTS.filter(p => p.area === a.name);
          const novos = ps.filter(p => p.tipo === "Novo Produto" && p.fase !== "Concluído").length;
          const melhorias = ps.filter(p => (p.tipo === "Melhoria" || p.tipo === "Redução de Custo") && p.fase !== "Concluído").length;
          const concNovos = ps.filter(p => p.tipo === "Novo Produto" && p.fase === "Concluído").length;
          const concMelh = ps.filter(p => (p.tipo === "Melhoria" || p.tipo === "Redução de Custo") && p.fase === "Concluído").length;
          return `<tr><td colspan="2" style="background:${a.color}08;border-radius:10px;padding:14px;border-left:3px solid ${a.color};">
            <div style="font-size:14px;font-weight:700;color:${a.color};margin-bottom:8px;">${a.icon} ${a.name}</div>
            <table width="100%"><tr>
              <td style="padding:4px 0;font-size:12px;">🆕 Novo Produto: <strong>${concNovos}/${2}</strong> entregues · ${novos} em andamento</td>
            </tr><tr>
              <td style="padding:4px 0;font-size:12px;">🔧 Melhoria/RC: <strong>${concMelh}/${2}</strong> entregues · ${melhorias} em andamento</td>
            </tr></table>
          </td></tr>`;
        }).join("")}
      </table>
    </div>

    <!-- Por Área -->
    ${areas.map(a => {
      const ps = PROJECTS.filter(p => p.area === a.name);
      if (!ps.length) return "";
      return `<div style="padding:0 20px 16px;">
        <h2 style="font-size:14px;color:${a.color};margin:0 0 8px;border-bottom:2px solid ${a.color}22;padding-bottom:6px;">${a.icon} ${a.name} (${ps.length})</h2>
        <table width="100%" cellpadding="0" cellspacing="0" style="font-size:12px;">
          <tr style="background:#F8F9FA;">
            <th style="text-align:left;padding:6px 8px;color:#86868B;font-size:10px;">PROJETO</th>
            <th style="text-align:left;padding:6px 8px;color:#86868B;font-size:10px;">TIPO</th>
            <th style="text-align:left;padding:6px 8px;color:#86868B;font-size:10px;">FASE</th>
            <th style="text-align:left;padding:6px 8px;color:#86868B;font-size:10px;">STATUS</th>
            <th style="text-align:right;padding:6px 8px;color:#86868B;font-size:10px;">ATRASO</th>
          </tr>
          ${ps.map(p => {
            const desl = calcDesl(p.previsao);
            const statusColor = p.status === "Atrasado" ? "#E8363C" : p.status === "No prazo" ? "#34C759" : p.status === "Em risco" ? "#FF9500" : "#AF52DE";
            const tipoEmoji = p.tipo === "Novo Produto" ? "🆕" : p.tipo === "Melhoria" ? "🔧" : p.tipo === "Redução de Custo" ? "💰" : "📋";
            return `<tr style="border-bottom:1px solid #F2F2F7;">
              <td style="padding:8px;font-weight:600;">${p.name}</td>
              <td style="padding:8px;">${tipoEmoji} ${p.tipo || "—"}</td>
              <td style="padding:8px;color:#6E6E73;">${p.fase}</td>
              <td style="padding:8px;"><span style="background:${statusColor}18;color:${statusColor};padding:2px 8px;border-radius:6px;font-weight:600;font-size:11px;">${p.status}</span></td>
              <td style="padding:8px;text-align:right;font-weight:600;color:${desl > 0 ? '#E8363C' : '#34C759'};font-family:monospace;">${desl !== null ? desl + 'd' : '—'}</td>
            </tr>`;
          }).join("")}
        </table>
      </div>`;
    }).join("")}

    <!-- Atualizações recentes -->
    ${updates.length > 0 ? `
    <div style="padding:0 20px 20px;">
      <h2 style="font-size:14px;color:#0088CC;margin:0 0 8px;">📱 Atualizações Recentes (Telegram)</h2>
      <div style="background:#F0F9FF;border-radius:10px;padding:12px;border:1px solid #0088CC22;">
        ${updates.map(u => `<div style="padding:6px 0;border-bottom:1px solid #E5E5EA;font-size:12px;">
          <strong>${u.project}</strong> — ${u.action}
          <div style="color:#86868B;font-size:10px;margin-top:2px;">📅 ${u.date || "recente"} · 👤 ${u.userName || "?"}</div>
        </div>`).join("")}
      </div>
    </div>` : ""}

    <!-- Footer -->
    <div style="background:#F8F9FA;padding:16px 20px;text-align:center;border-radius:0 0 12px 12px;border-top:1px solid #E5E5EA;">
      <p style="font-size:11px;color:#AEAEB2;margin:0;">Relatório automático · Policontrol Projetos</p>
      <p style="font-size:11px;color:#AEAEB2;margin:4px 0 0;">
        <a href="https://phcosta2-ops.github.io/projetos-policontrol/" style="color:#007AFF;text-decoration:none;">Abrir App →</a>
      </p>
    </div>
  </div>`;

  const subject = `📊 Relatório Projetos Policontrol — ${today} | ${atrasados} atrasado(s), ${noPrazo} no prazo`;
  
  const result = await sendEmail(subject, html);
  
  if (result.id) {
    console.log("✅ Email enviado para:", RECIPIENTS.join(", "));
  } else {
    console.error("❌ Erro:", result);
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
