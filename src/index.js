const {
  Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, AttachmentBuilder,
  SlashCommandBuilder, PermissionFlagsBits, ChannelType, OverwriteType, Partials,
} = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
// .env laden – damit funktioniert auch Startdatei `src/index.js` beim Hoster
const ENV = path.join(__dirname, '..', '.env');
if (!process.env.TOKEN && fs.existsSync(ENV)) process.loadEnvFile(ENV);
const db = require('./db');
const { renderSpawnerPanel } = require('./spawnerImage');
const { isStop, parseMoney, fmtMoney, CUSTOM_TYPES } = require('./util');
const web = require('./web');

const env = process.env;
// Einstellungen aus /setup; .env nur als Fallback für den Server aus GUILD_ID (IDs sind serverspezifisch)
const cfg = (key) => db.data.config[key] || (db.guildId() === env.GUILD_ID ? env[key] : undefined);
const BRAND = 0xf4b400;
const BRAND_NAME = 'HugoSMP Service Center';
const P = PermissionFlagsBits;

// GuildMessages + Partials.Message: gelöschte Map-Art-Posts verschwinden auch von der Website
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages], partials: [Partials.Message] });

// ---------- Helpers ----------

const embed = () => new EmbedBuilder()
  .setColor(BRAND)
  .setFooter({ text: BRAND_NAME, iconURL: env.LOGO_URL || undefined })
  .setTimestamp();

const row = (...c) => new ActionRowBuilder().addComponents(...c);
const input = (id, label, style = TextInputStyle.Short, required = true, placeholder, value) => {
  const t = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required);
  if (placeholder) t.setPlaceholder(placeholder);
  if (value) t.setValue(value);
  return row(t);
};
const modal = (id, title, ...rows) => new ModalBuilder().setCustomId(id).setTitle(title).addComponents(...rows);
const slug = (s) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
const openCount = (serviceId) => Object.values(db.data.open).filter((t) => t.serviceId === serviceId).length;
const findService = (id) => db.data.services.find((s) => s.id === id);
const findSpawner = (name) => db.data.spawners.find((s) => s.name.toLowerCase() === name.trim().toLowerCase());
const isTeam = (i, roleIds) => i.memberPermissions?.has(P.ManageGuild) || [].concat(roleIds).some((r) => r && i.member?.roles?.cache?.has(r));
const closeButton = () => new ButtonBuilder().setCustomId('close').setLabel('Ticket schließen').setEmoji('🔒').setStyle(ButtonStyle.Danger);
const starButtons = (prefix) => row(...[1, 2, 3, 4, 5].map((n) =>
  new ButtonBuilder().setCustomId(`${prefix}${n}`).setLabel('⭐'.repeat(n)).setStyle(n >= 4 ? ButtonStyle.Success : ButtonStyle.Secondary)));
const download = async (att) => Buffer.from(await (await fetch(att.url)).arrayBuffer());
const extOf = (name) => name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '');
// Schematic-Dateien privat speichern (nicht unter uploads/, das ist öffentlich)
const FILES = path.join(__dirname, '..', 'files');

const SUPPORT_TOPICS = {
  frage: { label: 'Allgemeine Frage', emoji: '❓', desc: 'Fragen zu Services, Preisen oder Ablauf' },
  bestellung: { label: 'Problem mit Bestellung', emoji: '📦', desc: 'Etwas stimmt mit deinem Auftrag nicht' },
  report: { label: 'Report / Beschwerde', emoji: '🚨', desc: 'Scam, Regelverstoß oder Beschwerde melden' },
  sonstiges: { label: 'Sonstiges', emoji: '💬', desc: 'Alles andere' },
};

// ---------- Panels ----------

function servicePanel() {
  const parts = ['**Herzlich willkommen im HugoSMP Service Center!**\nWähle unten im Menü deinen Service aus – es öffnet sich automatisch ein Ticket.'];
  for (const s of db.data.services) {
    const n = openCount(s.id);
    const full = s.limit && n >= s.limit;
    const status = !s.enabled ? '🔴 **Derzeit pausiert**'
      : full ? `🟡 **${n}/${s.limit} Tickets – Limit erreicht**`
      : s.limit ? `🟢 **${n}/${s.limit} Tickets**` : '🟢 **Verfügbar**';
    parts.push(s.enabled
      ? `### ${s.emoji} ${s.name}\n${s.description}\n${status}`
      : `### ${s.emoji} ~~${s.name}~~\n~~${s.description}~~\n${status}`);
  }
  parts.push('-# Für die Nutzung unserer Services ist ein verifizierter Minecraft-Account erforderlich.');

  const e = embed().setTitle(`💛 ${BRAND_NAME}`).setDescription(parts.join('\n\n'));
  if (!db.data.services.length) return { embeds: [e], components: [] };
  const menu = new StringSelectMenuBuilder().setCustomId('service').setPlaceholder('Service auswählen …')
    .addOptions(db.data.services.slice(0, 25).map((s) => ({ label: s.name, value: s.id, description: s.short.slice(0, 100), emoji: s.emoji })));
  return { embeds: [e], components: [row(menu)] };
}

function customPanel() {
  const lines = Object.entries(CUSTOM_TYPES).map(([k, t]) =>
    `### ${t.emoji} ${t.label}\n${t.desc}\n💰 **${db.data.customPrices[k]}** pro Map`);
  const e = embed().setTitle('🖼️ Custom Map-Art')
    .setDescription(['Du möchtest dein **eigenes Motiv** als Map-Art? Wähle unten die Bauart aus und schick uns dein Bild – wir bauen es für dich ingame.', ...lines,
      '-# Preis pro 128×128 Map. Der Endpreis wird im Ticket bestätigt.'].join('\n\n'));
  const menu = new StringSelectMenuBuilder().setCustomId('custom').setPlaceholder('Bauart auswählen …')
    .addOptions(Object.entries(CUSTOM_TYPES).map(([k, t]) => ({ label: t.label, value: k, emoji: t.emoji, description: `${db.data.customPrices[k]} pro Map` })));
  return { embeds: [e], components: [row(menu)] };
}

const spawnerImage = () => new AttachmentBuilder(renderSpawnerPanel(db.data.spawners), { name: 'spawner.png' });
const spawnerTradeButtons = () => [
  new ButtonBuilder().setCustomId('spawner:buy').setLabel('Spawner kaufen').setEmoji('🛒').setStyle(ButtonStyle.Success),
  new ButtonBuilder().setCustomId('spawner:sell').setLabel('Spawner verkaufen').setEmoji('💰').setStyle(ButtonStyle.Primary),
];

function spawnerPanel() {
  return {
    content: '',
    embeds: [],
    files: [spawnerImage()],
    components: [row(
      ...spawnerTradeButtons(),
      new ButtonBuilder().setCustomId('spawnerview').setLabel('Preise aktualisieren').setEmoji('🔄').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('spawneredit').setLabel('Preise setzen').setEmoji('⚙️').setStyle(ButtonStyle.Secondary),
    )],
  };
}

const AFK_ID = 'afk-service'; // Rollen & Ticket-Limit kommen vom gleichnamigen Service

// AFK-Ticket: Team übernimmt -> Kunde vouched im Ticket für den Übernehmer -> Button läuft aus
const afkTicketRow = (t) => row(
  new ButtonBuilder().setCustomId('afkclaim').setEmoji('🙋').setDisabled(Boolean(t.claimedBy))
    .setStyle(t.claimedBy ? ButtonStyle.Secondary : ButtonStyle.Primary)
    .setLabel(t.claimedBy ? `Übernommen von ${t.claimedName}`.slice(0, 80) : 'AFK übernehmen'),
  new ButtonBuilder().setCustomId('afkvouch').setEmoji(t.vouched ? '✅' : '⭐').setDisabled(Boolean(t.vouched))
    .setStyle(t.vouched ? ButtonStyle.Secondary : ButtonStyle.Success)
    .setLabel(t.vouched ? 'Vouch abgegeben – ausgelaufen' : 'Vouch abgeben'),
  closeButton(),
);

// Prüft, ob im aktuellen Kanal ein AFK-Vouch möglich ist; gibt Fehlertext oder das Ticket zurück
function afkVouchCheck(i) {
  const t = db.data.open[i.channelId];
  if (t?.serviceId !== AFK_ID) return { error: '❌ Das geht nur in einem AFK-Ticket.' };
  if (i.user.id !== t.userId) return { error: '⛔ Nur der Kunde dieses Tickets kann vouchen.' };
  if (!t.claimedBy) return { error: '⏳ Noch hat niemand aus dem Team deinen AFK Service übernommen.' };
  if (t.vouched) return { error: '✅ Für diesen AFK Service wurde bereits gevoucht.' };
  return { t };
}

async function postVouch({ user, stars, text, service, staffId, staffName }) {
  const ch = await client.channels.fetch(cfg('VOUCH_CHANNEL_ID')).catch(() => null);
  if (!ch) return false;
  const e = embed().setAuthor({ name: user.username, iconURL: user.displayAvatarURL() })
    .setTitle(`${'⭐'.repeat(stars)}${'☆'.repeat(5 - stars)}`)
    .setDescription(`>>> ${text}`)
    .addFields({ name: 'Service', value: service, inline: true }, { name: 'Kunde', value: `${user}`, inline: true });
  if (staffId) e.addFields({ name: 'Vouch für', value: `<@${staffId}>`, inline: true });
  await ch.send({ embeds: [e] });
  db.data.vouches.push({ user: user.username, avatar: user.displayAvatarURL({ size: 64 }), stars, text, service, staff: staffName, date: Date.now() });
  db.save();
  return true;
}
const AFK_UPTIMES = ['22h', '20h'];
const AFK_SELL = { order: 'Verkauf per /order', sell: 'Verkauf per /sell' };
const priceOr = (v) => (!v || v === '0' ? 'Auf Anfrage' : v);
const afkLabel = (pkg) => { const [tier, up] = pkg.split('-'); return `${tier === 'deluxe' ? 'Deluxe' : 'Standard'} · ${up} Uptime`; };

function afkPanel() {
  const p = db.data.afkPrices;
  const e = embed().setTitle('💤 AFK Service').setDescription([
    'Wir halten deine Farmen und Spawner am Laufen – du musst dafür nicht selbst online sein. Die Erträge verkaufen wir für dich per **/order** oder **/sell**.',
    `### ⏱️ Standard\nUptime wahlweise **22h** oder **20h** pro Tag.\n💰 22h: **${priceOr(p['22h'])}** · 20h: **${priceOr(p['20h'])}**`,
    `### 💎 Deluxe\nAlles aus Standard **plus Farm-Refill** – wir füllen deine Farm regelmäßig wieder auf.\n💰 **+${p.deluxe}** Aufpreis **+ Material**`,
    '-# Wähle unten dein Paket – danach die Verkaufsart, dann öffnet sich automatisch ein Ticket.',
  ].join('\n\n'));
  const menu = new StringSelectMenuBuilder().setCustomId('afk').setPlaceholder('Paket auswählen …').addOptions(
    ['standard', 'deluxe'].flatMap((tier) => AFK_UPTIMES.map((up) => ({
      label: afkLabel(`${tier}-${up}`), value: `${tier}-${up}`, emoji: tier === 'deluxe' ? '💎' : '⏱️',
      description: tier === 'deluxe' ? `${priceOr(p[up])} + ${p.deluxe} + Material · mit Farm-Refill` : priceOr(p[up]),
    }))));
  return { embeds: [e], components: [row(menu)] };
}

function mapartPanel() {
  const list = Object.entries(db.data.maparts).reverse().slice(0, 25);
  const e = embed().setTitle('🖼️ Map-Arts kaufen').setDescription([
    'Fertige Map-Arts aus unserem Bestand – wähle unten eine aus und es öffnet sich ein Ticket.',
    ...(list.length
      ? list.map(([, m]) => `### ${m.name}\n💰 **${m.price}** · 📐 ${m.size} · 👤 <@${m.ownerId}>${m.thirdParty ? ' · 3T' : ''}`)
      : ['*Gerade sind keine Map-Arts verfügbar – schau bald wieder vorbei oder bestell eine Custom Map-Art.*']),
    '-# Bilder findest du in den einzelnen Map-Art-Posts und auf unserer Website.',
  ].join('\n\n'));
  if (!list.length) return { embeds: [e], components: [] };
  const menu = new StringSelectMenuBuilder().setCustomId('mapartsel').setPlaceholder('Map-Art auswählen …')
    .addOptions(list.map(([id, m]) => ({ label: m.name.slice(0, 100), value: id, emoji: '🖼️', description: `${m.price} · ${m.size}`.slice(0, 100) })));
  return { embeds: [e], components: [row(menu)] };
}

// Digitale Produkte: Vorschaubild + private Datei, Auslieferung nach Bezahlung im Ticket
const SHOPS = {
  schematic: { label: 'Schematic', plural: 'Schematics', this: 'diese', your: 'deine', emoji: '📐', store: 'schematics', roleKey: 'SCHEMATIC_ROLE_ID',
    exts: ['litematic', 'schem', 'schematic', 'nbt'], intro: 'Fertige Schematics unserer Builder' },
  mod: { label: 'Mod', plural: 'Mods', this: 'diesen', your: 'dein', emoji: '🧩', store: 'mods', roleKey: 'MOD_ROLE_ID',
    exts: ['jar', 'zip'], intro: 'Mods für dein Minecraft' },
  watermark: { label: 'Watermark', plural: 'Watermarks', this: 'dieses', your: 'dein', emoji: '💧', store: 'watermarks', roleKey: 'WATERMARK_ROLE_ID',
    exts: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'zip', 'psd'], intro: 'Watermarks & Logos für deine Map-Arts und Bilder' },
};

const shopPanel = (k) => () => {
  const shop = SHOPS[k];
  const list = Object.entries(db.data[shop.store]).reverse().slice(0, 25);
  const e = embed().setTitle(`${shop.emoji} ${shop.plural} kaufen`).setDescription([
    `${shop.intro} – nach dem Kauf bekommst du die Datei direkt per DM.`,
    ...(list.length
      ? list.map(([, s]) => `### ${s.name}\n💰 **${s.price}** · 📄 .${extOf(s.file)}${s.desc ? `\n${s.desc.split('\n')[0].slice(0, 120)}` : ''}`)
      : [`*Gerade sind keine ${shop.plural} verfügbar – schau bald wieder vorbei.*`]),
    `-# Vorschaubilder findest du in den einzelnen ${shop.label}-Posts und auf unserer Website.`,
  ].join('\n\n'));
  if (!list.length) return { embeds: [e], components: [] };
  const menu = new StringSelectMenuBuilder().setCustomId(`shopsel:${k}`).setPlaceholder(`${shop.label} auswählen …`)
    .addOptions(list.map(([id, s]) => ({ label: s.name.slice(0, 100), value: id, emoji: shop.emoji, description: `${s.price} · .${extOf(s.file)}`.slice(0, 100) })));
  return { embeds: [e], components: [row(menu)] };
};

function supportPanel() {
  const e = embed().setTitle('🛟 Support').setDescription([
    'Du hast eine Frage oder ein Problem? Wähle unten dein Thema – es öffnet sich ein privates Ticket mit unserem Support-Team.',
    ...Object.values(SUPPORT_TOPICS).map((t) => `### ${t.emoji} ${t.label}\n${t.desc}`),
    '-# Bitte beschreibe dein Anliegen so genau wie möglich – so können wir schneller helfen.',
  ].join('\n\n'));
  const menu = new StringSelectMenuBuilder().setCustomId('support').setPlaceholder('Thema auswählen …')
    .addOptions(Object.entries(SUPPORT_TOPICS).map(([k, t]) => ({ label: t.label, value: k, emoji: t.emoji, description: t.desc })));
  return { embeds: [e], components: [row(menu)] };
}

const PANELS = { service: servicePanel, custom: customPanel, spawner: spawnerPanel, afk: afkPanel, mapart: mapartPanel, support: supportPanel,
  schematic: shopPanel('schematic'), mod: shopPanel('mod'), watermark: shopPanel('watermark') };

async function refresh(key) {
  const p = db.data.panels[key];
  if (!p) return;
  const ch = await client.channels.fetch(p.channelId).catch(() => null);
  const msg = await ch?.messages.fetch(p.messageId).catch(() => null);
  if (msg) await msg.edit({ ...PANELS[key](), attachments: [] }).catch(console.error);
}

// ---------- Tickets ----------

// Feste Ticket-Bereiche mit eigenem Zähler; Services aus /service kommen dynamisch dazu
const TICKET_TYPES = {
  afk: '⚡', mapart: '🖼️', custom: '🎨', spawner: '🥚', schematic: '📐', mod: '🧩', watermark: '💧', support: '🛟',
};
const ticketTypes = () => [...Object.keys(TICKET_TYPES), ...db.data.services.map((s) => slug(s.name).slice(0, 20)).filter(Boolean)];

async function openTicket(i, { kind, serviceId = null, label, prefix, emoji = TICKET_TYPES[prefix] ?? '🎫', roleIds = [], extraUserIds = [], info, buttons = [] }) {
  const g = i.guild;
  const dup = Object.entries(db.data.open).find(([, t]) => t.userId === i.user.id && t.kind === kind && t.serviceId === serviceId);
  if (dup) return i.editReply(`Du hast bereits ein offenes Ticket: <#${dup[0]}>`);

  const allow = [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles];
  const roles = roleIds.filter((id) => id && g.roles.cache.has(id));
  const extras = [];
  for (const id of extraUserIds) if (id !== i.user.id && (await g.members.fetch(id).catch(() => null))) extras.push(id);
  const number = db.data.counters[prefix] = (db.data.counters[prefix] ?? 0) + 1;

  const ch = await g.channels.create({
    // z. B. "⚡afk-209" – die Nummer zeigt neuen Kunden, wie viele Tickets es schon gab
    name: `${emoji.startsWith('<') ? '' : emoji}${prefix}-${number}`,
    type: ChannelType.GuildText,
    // Eigene Kategorie pro Bereich (/ticketkategorie), sonst Standard; gelöschte Kategorie -> Standard
    parent: [db.data.categories[prefix], cfg('TICKET_CATEGORY_ID')].find((id) => id && g.channels.cache.has(id)) ?? null,
    permissionOverwrites: [
      { id: g.roles.everyone.id, deny: [P.ViewChannel] },
      { id: client.user.id, allow: [...allow, P.ManageChannels], type: OverwriteType.Member },
      ...[i.user.id, ...extras].map((id) => ({ id, allow, type: OverwriteType.Member })),
      ...roles.map((id) => ({ id, allow, type: OverwriteType.Role })),
    ],
  });

  const t = db.data.open[ch.id] = { userId: i.user.id, kind, serviceId, label, number };

  const msg = await ch.send({
    content: [i.user, ...extras.map((id) => `<@${id}>`), ...roles.map((id) => `<@&${id}>`)].join(' '),
    embeds: [info.setTitle(`${emoji} ${label} · Ticket #${number}`)],
    components: [serviceId === AFK_ID ? afkTicketRow(t) : row(...buttons, closeButton())],
  });
  t.messageId = msg.id;
  db.save();
  if (serviceId) refresh('service');
  return i.editReply(`✅ Dein Ticket wurde erstellt: ${ch}`);
}

function vouchPrompt(label) {
  const l = label.slice(0, 60);
  return {
    embeds: [embed().setTitle('⭐ Wie zufrieden warst du?')
      .setDescription(`Danke, dass du das **${BRAND_NAME}** genutzt hast!\n\nBewerte deinen Service **${l}** – deine Bewertung wird im Vouch-Kanal veröffentlicht.`)],
    components: [row(...[1, 2, 3, 4, 5].map((n) =>
      // Server-ID im Button: die DM hat keinen Server-Kontext
      new ButtonBuilder().setCustomId(`vouch:${db.guildId()}:${n}:${l}`).setLabel('⭐'.repeat(n)).setStyle(n >= 4 ? ButtonStyle.Success : ButtonStyle.Secondary)))],
  };
}

// ---------- Commands ----------

const admin = P.ManageGuild;
const commands = [
  new SlashCommandBuilder().setName('panel').setDescription('Panel in diesem Kanal senden').setDefaultMemberPermissions(admin)
    .addStringOption((o) => o.setName('typ').setDescription('Welches Panel?').setRequired(true)
      .addChoices({ name: 'Services', value: 'service' }, { name: 'Custom Map-Art', value: 'custom' }, { name: 'Spawner Handel', value: 'spawner' }, { name: 'AFK Service', value: 'afk' }, { name: 'Map-Arts', value: 'mapart' },
        { name: 'Schematics', value: 'schematic' }, { name: 'Mods', value: 'mod' }, { name: 'Watermarks', value: 'watermark' }, { name: 'Support', value: 'support' })),

  // /schematic, /mod, /watermark
  ...Object.entries(SHOPS).map(([k, shop]) => new SlashCommandBuilder().setName(k).setDescription(`${shop.label} zum Verkauf posten`).setDefaultMemberPermissions(admin)
    .addAttachmentOption((o) => o.setName('bild').setDescription('Vorschaubild').setRequired(true))
    .addAttachmentOption((o) => o.setName('datei').setDescription(`${shop.exts.map((e) => `.${e}`).join(' / ')} – wird nach Kauf ausgeliefert`).setRequired(true))
    .addStringOption((o) => o.setName('name').setDescription('Name').setRequired(true).setMaxLength(80))
    .addStringOption((o) => o.setName('preis').setDescription('z. B. 3M').setRequired(true))
    .addStringOption((o) => o.setName('beschreibung').setDescription('Kurzbeschreibung (\\n = neue Zeile)').setMaxLength(500))),

  new SlashCommandBuilder().setName('afkpreis').setDescription('Preise für das AFK-Panel setzen').setDefaultMemberPermissions(admin)
    .addStringOption((o) => o.setName('paket').setDescription('Was?').setRequired(true)
      .addChoices({ name: '22h Uptime', value: '22h' }, { name: '20h Uptime', value: '20h' }, { name: 'Deluxe-Aufpreis (Farm-Refill)', value: 'deluxe' }))
    .addStringOption((o) => o.setName('preis').setDescription('z. B. 3M / Woche').setRequired(true).setMaxLength(40)),

  new SlashCommandBuilder().setName('service').setDescription('Services verwalten').setDefaultMemberPermissions(admin)
    .addSubcommand((s) => s.setName('add').setDescription('Service hinzufügen')
      .addStringOption((o) => o.setName('name').setDescription('Name').setRequired(true).setMaxLength(60))
      .addStringOption((o) => o.setName('emoji').setDescription('Emoji').setRequired(true))
      .addStringOption((o) => o.setName('beschreibung').setDescription('Text im Panel (\\n = neue Zeile)').setRequired(true).setMaxLength(600))
      .addStringOption((o) => o.setName('kurz').setDescription('Kurztext im Dropdown').setRequired(true).setMaxLength(100))
      .addIntegerOption((o) => o.setName('limit').setDescription('Max. offene Tickets (0 = kein Limit)').setMinValue(0))
      .addRoleOption((o) => o.setName('rolle').setDescription('Support-Rolle für diesen Service')))
    .addSubcommand((s) => s.setName('remove').setDescription('Service entfernen')
      .addStringOption((o) => o.setName('service').setDescription('Service').setRequired(true).setAutocomplete(true)))
    .addSubcommand((s) => s.setName('toggle').setDescription('Service aktivieren / pausieren')
      .addStringOption((o) => o.setName('service').setDescription('Service').setRequired(true).setAutocomplete(true)))
    .addSubcommand((s) => s.setName('limit').setDescription('Ticket-Limit setzen')
      .addStringOption((o) => o.setName('service').setDescription('Service').setRequired(true).setAutocomplete(true))
      .addIntegerOption((o) => o.setName('limit').setDescription('0 = kein Limit').setRequired(true).setMinValue(0)))
    .addSubcommand((s) => s.setName('rolle').setDescription('Support-Rolle hinzufügen / entfernen')
      .addStringOption((o) => o.setName('service').setDescription('Service').setRequired(true).setAutocomplete(true))
      .addRoleOption((o) => o.setName('rolle').setDescription('Rolle').setRequired(true))),

  new SlashCommandBuilder().setName('mapart').setDescription('Map-Art zum Verkauf posten').setDefaultMemberPermissions(admin)
    .addAttachmentOption((o) => o.setName('bild').setDescription('Vorschau').setRequired(true))
    .addStringOption((o) => o.setName('name').setDescription('Name').setRequired(true).setMaxLength(80))
    .addStringOption((o) => o.setName('preis').setDescription('z. B. 2.5M').setRequired(true))
    .addStringOption((o) => o.setName('groesse').setDescription('z. B. 2x2 Maps').setRequired(true))
    .addUserOption((o) => o.setName('besitzer').setDescription('Besitzer der Map-Art').setRequired(true))
    .addBooleanOption((o) => o.setName('drittbesitzer').setDescription('3T-Besitzer? Wird dann dem Ticket hinzugefügt')),

  new SlashCommandBuilder().setName('custompreis').setDescription('Preis pro Map für Custom Map-Art setzen').setDefaultMemberPermissions(admin)
    .addStringOption((o) => o.setName('typ').setDescription('Bauart').setRequired(true)
      .addChoices(...Object.entries(CUSTOM_TYPES).map(([k, t]) => ({ name: t.label, value: k }))))
    .addStringOption((o) => o.setName('preis').setDescription('z. B. 500k').setRequired(true)),

  new SlashCommandBuilder().setName('spawner').setDescription('Spawner-Preise verwalten').setDefaultMemberPermissions(admin)
    .addSubcommand((s) => s.setName('set').setDescription('Spawner anlegen / Preise ändern')
      .addStringOption((o) => o.setName('name').setDescription('Spawner').setRequired(true).setAutocomplete(true))
      .addStringOption((o) => o.setName('erhaeltst').setDescription('Du erhältst (Ankauf) – z. B. 6.5M oder STOP').setRequired(true))
      .addStringOption((o) => o.setName('zahlst').setDescription('Du zahlst (Verkauf) – z. B. 6M oder STOP').setRequired(true))
      .addStringOption((o) => o.setName('farbe').setDescription('Mob-Farbe als Hex, z. B. #4caf50')))
    .addSubcommand((s) => s.setName('remove').setDescription('Spawner entfernen')
      .addStringOption((o) => o.setName('name').setDescription('Spawner').setRequired(true).setAutocomplete(true))),

  new SlashCommandBuilder().setName('ticketkategorie').setDescription('Eigene Discord-Kategorie für einen Ticket-Bereich').setDefaultMemberPermissions(admin)
    .addStringOption((o) => o.setName('bereich').setDescription('z. B. afk, spawner, custom-texture-pack').setRequired(true).setAutocomplete(true))
    .addChannelOption((o) => o.setName('kategorie').setDescription('Leer lassen = Standard-Kategorie (TICKET_CATEGORY_ID)').addChannelTypes(ChannelType.GuildCategory)),

  new SlashCommandBuilder().setName('setup').setDescription('Kanäle & Rollen einstellen – ohne Optionen: aktuelle Einstellungen anzeigen').setDefaultMemberPermissions(admin)
    .addChannelOption((o) => o.setName('ticketkategorie').setDescription('Standard-Kategorie für Tickets').addChannelTypes(ChannelType.GuildCategory))
    .addChannelOption((o) => o.setName('vouchkanal').setDescription('Kanal, in den Vouches gepostet werden').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
    .addRoleOption((o) => o.setName('afk_rolle').setDescription('Support-Rolle für AFK-Tickets'))
    .addRoleOption((o) => o.setName('mapart_rolle').setDescription('Support-Rolle für Map-Art- & Custom-Map-Art-Tickets'))
    .addRoleOption((o) => o.setName('spawner_rolle').setDescription('Support-Rolle für Spawner-Tickets & Preis-Button'))
    .addRoleOption((o) => o.setName('schematic_rolle').setDescription('Support-Rolle für Schematic-Tickets & Datei-Auslieferung'))
    .addRoleOption((o) => o.setName('mod_rolle').setDescription('Support-Rolle für Mod-Tickets & Datei-Auslieferung'))
    .addRoleOption((o) => o.setName('watermark_rolle').setDescription('Support-Rolle für Watermark-Tickets & Datei-Auslieferung'))
    .addRoleOption((o) => o.setName('support_rolle').setDescription('Rolle für allgemeine Support-Tickets')),

  new SlashCommandBuilder().setName('vouchanfrage').setDescription('Vouch-Anfrage per DM an einen Kunden senden').setDefaultMemberPermissions(P.ManageMessages)
    .addUserOption((o) => o.setName('kunde').setDescription('Wer soll bewerten?').setRequired(true))
    .addStringOption((o) => o.setName('service').setDescription('z. B. AFK Service – Standard: aktuelles Ticket').setMaxLength(60)),

  new SlashCommandBuilder().setName('vouch').setDescription('Bewertung per DM abgeben'),
];

const SETUP = {
  ticketkategorie: ['TICKET_CATEGORY_ID', 'Ticket-Kategorie (Standard)', '#'],
  vouchkanal: ['VOUCH_CHANNEL_ID', 'Vouch-Kanal', '#'],
  mapart_rolle: ['MAPART_ROLE_ID', 'Map-Art-Rolle', '@&'],
  spawner_rolle: ['SPAWNER_ROLE_ID', 'Spawner-Rolle', '@&'],
  schematic_rolle: ['SCHEMATIC_ROLE_ID', 'Schematic-Rolle', '@&'],
  mod_rolle: ['MOD_ROLE_ID', 'Mod-Rolle', '@&'],
  watermark_rolle: ['WATERMARK_ROLE_ID', 'Watermark-Rolle', '@&'],
  support_rolle: ['SUPPORT_ROLE_ID', 'Support-Rolle', '@&'],
};

function setupOverview() {
  const val = (id, p) => (id ? `<${p}${id}>` : '❌ nicht gesetzt');
  const afk = findService(AFK_ID);
  const lines = Object.values(SETUP).map(([key, label, p]) => `**${label}:** ${val(cfg(key), p)}`);
  lines.push(`**AFK-Rollen:** ${afk?.roleIds.length ? afk.roleIds.map((r) => `<@&${r}>`).join(', ') : '❌ nicht gesetzt'}`);
  const cats = Object.entries(db.data.categories);
  if (cats.length) lines.push(`**Eigene Kategorien:** ${cats.map(([k, id]) => `${k} → <#${id}>`).join(', ')}`);
  return embed().setTitle('⚙️ Setup').setDescription([
    lines.join('\n'),
    '-# Ändern: `/setup` mit Optionen · Kategorie pro Bereich: `/ticketkategorie` · Panels posten: `/panel`',
  ].join('\n\n'));
}

async function onCommand(i) {
  const sub = i.options.getSubcommand(false);

  if (i.commandName === 'panel') {
    const key = i.options.getString('typ');
    await i.deferReply({ ephemeral: true });
    const msg = await i.channel.send(PANELS[key]());
    db.data.panels[key] = { channelId: msg.channelId, messageId: msg.id };
    db.save();
    return i.editReply('✅ Panel gesendet. Es aktualisiert sich bei Änderungen automatisch.');
  }

  if (i.commandName === 'service') {
    const s = findService(i.options.getString('service') ?? '');
    if (sub === 'add') {
      const name = i.options.getString('name');
      const id = slug(name) || Date.now().toString(36);
      if (findService(id)) return i.reply({ content: '❌ Diesen Service gibt es schon.', ephemeral: true });
      if (db.data.services.length >= 25) return i.reply({ content: '❌ Maximal 25 Services.', ephemeral: true });
      const role = i.options.getRole('rolle');
      db.data.services.push({
        id, name, emoji: i.options.getString('emoji'), enabled: true,
        description: i.options.getString('beschreibung').replaceAll('\\n', '\n'),
        short: i.options.getString('kurz'), limit: i.options.getInteger('limit') ?? 0, roleIds: role ? [role.id] : [],
      });
    } else {
      if (!s) return i.reply({ content: '❌ Service nicht gefunden.', ephemeral: true });
      if (sub === 'remove') db.data.services.splice(db.data.services.indexOf(s), 1);
      if (sub === 'toggle') s.enabled = !s.enabled;
      if (sub === 'limit') s.limit = i.options.getInteger('limit');
      if (sub === 'rolle') {
        const r = i.options.getRole('rolle').id;
        s.roleIds = s.roleIds.includes(r) ? s.roleIds.filter((x) => x !== r) : [...s.roleIds, r];
      }
    }
    db.save();
    await refresh('service');
    const now = findService(s?.id ?? slug(i.options.getString('name') ?? ''));
    const roles = now?.roleIds.map((r) => `<@&${r}>`).join(', ') || '–';
    return i.reply({ content: `✅ Gespeichert.${now ? `\nSupport-Rollen für **${now.name}**: ${roles}` : ''}`, ephemeral: true });
  }

  if (i.commandName === 'mapart') {
    await i.deferReply({ ephemeral: true });
    const att = i.options.getAttachment('bild');
    if (!att.contentType?.startsWith('image/')) return i.editReply('❌ Bitte ein Bild hochladen.');
    const owner = i.options.getUser('besitzer');
    const thirdParty = i.options.getBoolean('drittbesitzer') ?? false;
    const id = Date.now().toString(36);
    const m = { name: i.options.getString('name'), price: i.options.getString('preis'), size: i.options.getString('groesse'), ownerId: owner.id, thirdParty };
    // Bild neu hochladen, Discord-CDN-Links von Slash-Attachments laufen ab
    const ext = att.name.split('.').pop().toLowerCase().replace(/[^a-z]/g, '');
    const buf = Buffer.from(await (await fetch(att.url)).arrayBuffer());
    const file = new AttachmentBuilder(buf, { name: `mapart.${ext}` });
    fs.mkdirSync(web.UPLOADS, { recursive: true });
    fs.writeFileSync(path.join(web.UPLOADS, `${id}.${ext}`), buf);
    Object.assign(m, { image: `${id}.${ext}`, ownerName: owner.username });
    const e = embed().setTitle(`🖼️ ${m.name}`).setImage(`attachment://mapart.${ext}`).addFields(
      { name: '💰 Preis', value: m.price, inline: true },
      { name: '📐 Größe', value: m.size, inline: true },
      { name: '👤 Besitzer', value: `${owner}${thirdParty ? ' · 3T' : ''}`, inline: true },
    );
    const msg = await i.channel.send({
      embeds: [e], files: [file],
      components: [row(new ButtonBuilder().setCustomId(`mapart:${id}`).setLabel('Map-Art kaufen').setEmoji('🛒').setStyle(ButtonStyle.Success))],
    });
    db.data.maparts[id] = { ...m, messageId: msg.id };
    db.save();
    await refresh('mapart');
    return i.editReply('✅ Map-Art gepostet.');
  }

  if (SHOPS[i.commandName]) {
    const k = i.commandName, shop = SHOPS[k];
    await i.deferReply({ ephemeral: true });
    const img = i.options.getAttachment('bild');
    const dat = i.options.getAttachment('datei');
    if (!img.contentType?.startsWith('image/')) return i.editReply('❌ Das Vorschaubild muss ein Bild sein.');
    const id = Date.now().toString(36);
    const iext = extOf(img.name), dext = extOf(dat.name);
    if (!shop.exts.includes(dext)) return i.editReply(`❌ Datei muss ${shop.exts.map((x) => `.${x}`).join(', ')} sein.`);
    const imgBuf = await download(img);
    fs.mkdirSync(web.UPLOADS, { recursive: true });
    fs.mkdirSync(FILES, { recursive: true });
    fs.writeFileSync(path.join(web.UPLOADS, `${id}.${iext}`), imgBuf);
    fs.writeFileSync(path.join(FILES, `${id}.${dext}`), await download(dat));
    const s = {
      name: i.options.getString('name'), price: i.options.getString('preis'),
      desc: (i.options.getString('beschreibung') ?? '').replaceAll('\\n', '\n'),
      image: `${id}.${iext}`, file: `${id}.${dext}`, fileName: dat.name.replace(/[^\w.-]/g, '_'),
    };
    const e = embed().setTitle(`${shop.emoji} ${s.name}`).setImage(`attachment://preview.${iext}`).addFields(
      { name: '💰 Preis', value: s.price, inline: true },
      { name: '📄 Format', value: `.${dext}`, inline: true },
      { name: '📦 Lieferung', value: 'Datei nach Kauf per DM', inline: true },
    );
    if (s.desc) e.setDescription(s.desc);
    const msg = await i.channel.send({
      embeds: [e], files: [new AttachmentBuilder(imgBuf, { name: `preview.${iext}` })],
      components: [row(new ButtonBuilder().setCustomId(`shop:${k}:${id}`).setLabel(`${shop.label} kaufen`).setEmoji('🛒').setStyle(ButtonStyle.Success))],
    });
    db.data[shop.store][id] = { ...s, messageId: msg.id };
    db.save();
    await refresh(k);
    return i.editReply(`✅ ${shop.label} gepostet. Die Datei ist hinterlegt und wird nach dem Kauf im Ticket per Button ausgeliefert.`);
  }

  if (i.commandName === 'afkpreis') {
    db.data.afkPrices[i.options.getString('paket')] = i.options.getString('preis');
    db.save();
    await refresh('afk');
    return i.reply({ content: '✅ AFK-Preis gespeichert.', ephemeral: true });
  }

  if (i.commandName === 'custompreis') {
    db.data.customPrices[i.options.getString('typ')] = i.options.getString('preis');
    db.save();
    await refresh('custom');
    return i.reply({ content: '✅ Preis gespeichert.', ephemeral: true });
  }

  if (i.commandName === 'spawner') {
    const name = i.options.getString('name').trim();
    let s = findSpawner(name);
    if (sub === 'remove') {
      if (!s) return i.reply({ content: '❌ Spawner nicht gefunden.', ephemeral: true });
      db.data.spawners.splice(db.data.spawners.indexOf(s), 1);
    } else {
      const color = i.options.getString('farbe');
      if (color && !/^#[0-9a-f]{6}$/i.test(color)) return i.reply({ content: '❌ Farbe muss so aussehen: `#4caf50`', ephemeral: true });
      if (!s) db.data.spawners.push((s = { name, color: '#9e9e9e' }));
      s.get = i.options.getString('erhaeltst');
      s.pay = i.options.getString('zahlst');
      if (color) s.color = color;
    }
    db.save();
    await i.deferReply({ ephemeral: true });
    await refresh('spawner');
    return i.editReply('✅ Spawner-Panel aktualisiert.');
  }

  if (i.commandName === 'ticketkategorie') {
    const key = i.options.getString('bereich');
    if (!ticketTypes().includes(key)) return i.reply({ content: `❌ Unbekannter Bereich. Möglich: ${ticketTypes().join(', ')}`, ephemeral: true });
    const cat = i.options.getChannel('kategorie');
    if (cat) db.data.categories[key] = cat.id;
    else delete db.data.categories[key];
    db.save();
    return i.reply({ content: `✅ **${key}**-Tickets landen jetzt in ${cat ? `**${cat.name}**` : 'der Standard-Kategorie'}.`, ephemeral: true });
  }

  if (i.commandName === 'setup') {
    for (const [opt, [key]] of Object.entries(SETUP)) {
      const id = i.options.get(opt)?.value; // Kanal- oder Rollen-ID
      if (id) db.data.config[key] = id;
    }
    const afkRole = i.options.getRole('afk_rolle');
    const afk = findService(AFK_ID);
    if (afkRole && afk && !afk.roleIds.includes(afkRole.id)) afk.roleIds.push(afkRole.id);
    db.save();
    return i.reply({ embeds: [setupOverview()], ephemeral: true });
  }

  if (i.commandName === 'vouchanfrage') {
    const user = i.options.getUser('kunde');
    const label = i.options.getString('service') ?? db.data.open[i.channelId]?.label ?? BRAND_NAME;
    const ok = await user.send(vouchPrompt(label)).catch(() => null);
    return i.reply({ content: ok ? `📬 Vouch-Anfrage an ${user} gesendet (${label}).` : `❌ ${user} hat DMs deaktiviert.`, ephemeral: true });
  }

  if (i.commandName === 'vouch') {
    // Im AFK-Ticket: Vouch für den Übernehmer direkt hier
    if (db.data.open[i.channelId]?.serviceId === AFK_ID) return onComponent(Object.assign(i, { customId: 'afkvouch' }));
    const ok = await i.user.send(vouchPrompt(BRAND_NAME)).catch(() => null);
    return i.reply({ content: ok ? '📬 Schau in deine DMs!' : '❌ Ich kann dir keine DM senden – bitte DMs aktivieren.', ephemeral: true });
  }
}

// ---------- Components & Modals ----------

async function onComponent(i) {
  const [id, ...rest] = i.customId.split(':');
  const arg = rest.join(':');

  if (id === 'service') {
    const s = findService(i.values[0]);
    if (!s) return i.reply({ content: '❌ Diesen Service gibt es nicht mehr.', ephemeral: true });
    if (!s.enabled) return i.reply({ content: `🔴 **${s.name}** ist derzeit pausiert.`, ephemeral: true });
    if (s.limit && openCount(s.id) >= s.limit) return i.reply({ content: `🟡 **${s.name}** hat das Ticket-Limit erreicht. Versuch es später erneut.`, ephemeral: true });
    return i.showModal(modal(`servicem:${s.id}`, s.name.slice(0, 45),
      input('ign', 'Minecraft-Name'),
      input('details', 'Was genau brauchst du?', TextInputStyle.Paragraph, true,
        s.id === 'afk-service' ? 'z. B. Spawner-Farm bei X/Z, gewünschte Dauer …' : undefined)));
  }

  if (id === 'afk') {
    const s = findService(AFK_ID);
    if (s && !s.enabled) return i.reply({ content: '🔴 Der AFK Service ist derzeit pausiert.', ephemeral: true });
    if (s?.limit && openCount(AFK_ID) >= s.limit) return i.reply({ content: '🟡 Der AFK Service hat das Ticket-Limit erreicht. Versuch es später erneut.', ephemeral: true });
    const pkg = i.values[0];
    return i.reply({
      ephemeral: true,
      content: `**${afkLabel(pkg)}** – wie sollen wir die Erträge verkaufen?`,
      components: [row(...Object.entries(AFK_SELL).map(([k, label]) =>
        new ButtonBuilder().setCustomId(`afksell:${pkg}:${k}`).setLabel(label).setStyle(ButtonStyle.Primary)))],
    });
  }

  if (id === 'afksell') {
    return i.showModal(modal(`afkm:${arg}`, `AFK · ${afkLabel(rest[0])}`,
      input('ign', 'Minecraft-Name'),
      input('farm', 'Welche Farm / Spawner? (inkl. Koordinaten)', TextInputStyle.Paragraph, true, 'z. B. Eisenfarm bei X 1200 / Z -340'),
      input('dauer', 'Wie lange?', TextInputStyle.Short, true, 'z. B. 7 Tage')));
  }

  if (id === 'custom') {
    const t = CUSTOM_TYPES[i.values[0]];
    return i.showModal(modal(`customm:${i.values[0]}`, `Custom Map-Art · ${t.label}`,
      input('ign', 'Minecraft-Name'),
      input('maps', 'Anzahl Maps', TextInputStyle.Short, true, 'z. B. 4 (für 2x2)'),
      input('motiv', 'Motiv (Bild-Link oder Beschreibung)', TextInputStyle.Paragraph),
      input('notes', 'Anmerkungen', TextInputStyle.Paragraph, false)));
  }

  // Für alle: aktuellen Stand nur für den Klickenden neu rendern
  if (id === 'spawnerview') {
    return i.reply({
      ephemeral: true,
      content: `🔄 **Aktuelle Spawner-Preise** · Stand <t:${Math.floor(Date.now() / 1000)}:T>`,
      files: [spawnerImage()],
      components: [row(...spawnerTradeButtons())],
    });
  }

  if (id === 'spawneredit') {
    if (!isTeam(i, cfg('SPAWNER_ROLE_ID'))) return i.reply({ content: '⛔ Nur das Team kann Spawner-Preise ändern.', ephemeral: true });
    // Button -> Auswahl, Auswahl -> Formular mit aktuellen Werten
    if (i.isButton()) {
      const menu = new StringSelectMenuBuilder().setCustomId('spawneredit').setPlaceholder('Spawner auswählen …').addOptions(
        ...db.data.spawners.slice(0, 24).map((s) => ({ label: s.name, value: s.name, description: `Du erhältst ${s.get || 'STOP'} · Du zahlst ${s.pay || 'STOP'}` })),
        { label: 'Neuer Spawner', value: '__new', emoji: '➕' },
      );
      return i.reply({ content: 'Welchen Spawner möchtest du aktualisieren?', components: [row(menu)], ephemeral: true });
    }
    const s = i.values[0] === '__new' ? null : findSpawner(i.values[0]);
    return i.showModal(modal(`spawnerset:${s?.name ?? ''}`, s ? `${s.name} aktualisieren`.slice(0, 45) : 'Neuer Spawner',
      input('name', 'Name', TextInputStyle.Short, true, 'z. B. Creeper', s?.name),
      input('get', 'Du erhältst (Ankauf) – Preis oder STOP', TextInputStyle.Short, true, 'z. B. 6.5M', s?.get),
      input('pay', 'Du zahlst (Verkauf) – Preis oder STOP', TextInputStyle.Short, true, 'z. B. 6M', s?.pay),
      input('color', 'Mob-Farbe (Hex)', TextInputStyle.Short, false, '#4caf50', s?.color)));
  }

  if (id === 'spawner') {
    const buy = arg === 'buy';
    return i.showModal(modal(`spawnerm:${arg}`, buy ? 'Spawner kaufen' : 'Spawner verkaufen',
      input('ign', 'Minecraft-Name'),
      input('type', 'Spawner-Typ', TextInputStyle.Short, true, db.data.spawners.map((s) => s.name).join(', ').slice(0, 100)),
      input('amount', 'Anzahl', TextInputStyle.Short, true, 'z. B. 3')));
  }

  if (id === 'mapart' || id === 'mapartsel') {
    const m = db.data.maparts[id === 'mapart' ? arg : i.values[0]];
    if (!m) return i.reply({ content: '❌ Diese Map-Art ist nicht mehr verfügbar.', ephemeral: true });
    await i.deferReply({ ephemeral: true });
    const info = embed().setDescription(`${i.user} möchte diese Map-Art kaufen.\nEin Teammitglied meldet sich gleich bei dir.`)
      .addFields(
        { name: '🖼️ Map-Art', value: m.name, inline: true },
        { name: '💰 Preis', value: m.price, inline: true },
        { name: '📐 Größe', value: m.size, inline: true },
        { name: '👤 Besitzer', value: `<@${m.ownerId}>${m.thirdParty ? ' · 3T' : ''}`, inline: true },
      );
    const img = id === 'mapart' && i.message.embeds[0]?.image?.url;
    if (img) info.setThumbnail(img);
    return openTicket(i, {
      kind: 'mapart', label: `Map-Art: ${m.name}`, prefix: 'mapart', info,
      roleIds: [cfg('MAPART_ROLE_ID')], extraUserIds: m.thirdParty ? [m.ownerId] : [],
    });
  }

  // Shop-Kauf: shop:<kategorie>:<id> (Button), shopsel:<kategorie> (Dropdown); schem/schemsel = alte Schematic-Posts
  if (['shop', 'shopsel', 'schem', 'schemsel'].includes(id)) {
    const k = id.startsWith('schem') ? 'schematic' : rest[0];
    const shop = SHOPS[k];
    const pid = id.endsWith('sel') ? i.values[0] : id === 'schem' ? arg : rest[1];
    const s = shop && db.data[shop.store][pid];
    if (!s) return i.reply({ content: `❌ Dieses Produkt ist nicht mehr verfügbar.`, ephemeral: true });
    await i.deferReply({ ephemeral: true });
    const info = embed().setDescription(`${i.user} möchte ${shop.this} ${shop.label} kaufen.\nNach der Bezahlung liefert das Team die Datei per Button aus.`)
      .addFields({ name: `${shop.emoji} ${shop.label}`, value: s.name, inline: true }, { name: '💰 Preis', value: s.price, inline: true }, { name: '📄 Format', value: `.${extOf(s.file)}`, inline: true });
    const img = !id.endsWith('sel') && i.message.embeds[0]?.image?.url;
    if (img) info.setThumbnail(img);
    return openTicket(i, {
      kind: k, label: `${shop.label}: ${s.name}`, prefix: k, info, roleIds: [cfg(shop.roleKey)],
      buttons: [new ButtonBuilder().setCustomId(`shopsend:${k}:${pid}`).setLabel('Bezahlt – Datei senden').setEmoji('📤').setStyle(ButtonStyle.Success)],
    });
  }

  if (id === 'shopsend' || id === 'schemsend') {
    const k = id === 'schemsend' ? 'schematic' : rest[0];
    const shop = SHOPS[k];
    if (!isTeam(i, cfg(shop.roleKey))) return i.reply({ content: '⛔ Nur das Team kann die Datei ausliefern.', ephemeral: true });
    const s = db.data[shop.store][id === 'schemsend' ? arg : rest[1]];
    const t = db.data.open[i.channelId];
    const file = s && path.join(FILES, s.file);
    if (!s || !t || !fs.existsSync(file)) return i.reply({ content: '❌ Datei nicht gefunden.', ephemeral: true });
    await i.deferUpdate();
    const buyer = await client.users.fetch(t.userId);
    const delivery = { embeds: [embed().setTitle(`📦 ${s.name}`).setDescription(`Danke für deinen Kauf im **${BRAND_NAME}**! Hier ist ${shop.your} ${shop.label}.`)] };
    const dm = await buyer.send({ ...delivery, files: [new AttachmentBuilder(file, { name: s.fileName })] }).catch(() => null);
    // Zusätzlich im Ticket, falls DMs zu sind
    await i.channel.send({ content: `${buyer} ${dm ? '📬 Datei wurde dir auch per DM geschickt.' : '⚠️ DM nicht möglich – hier ist deine Datei:'}`, ...delivery, files: [new AttachmentBuilder(file, { name: s.fileName })] });
    return i.message.edit({ components: [row(
      new ButtonBuilder().setCustomId('schemsent').setLabel(`Ausgeliefert von ${i.user.username}`.slice(0, 80)).setEmoji('✅').setStyle(ButtonStyle.Secondary).setDisabled(true),
      closeButton(),
    )] });
  }

  if (id === 'support') {
    const t = SUPPORT_TOPICS[i.values[0]];
    return i.showModal(modal(`supportm:${i.values[0]}`, `Support · ${t.label}`,
      input('ign', 'Minecraft-Name'),
      input('betreff', 'Betreff', TextInputStyle.Short, true, 'Kurz in ein paar Worten'),
      input('details', 'Beschreibung', TextInputStyle.Paragraph, true, 'Was ist passiert? Je genauer, desto schneller können wir helfen.')));
  }

  if (id === 'close') {
    const t = db.data.open[i.channelId];
    await i.reply({ embeds: [embed().setDescription(`🔒 Ticket wird von ${i.user} geschlossen …`)] });
    if (t && !t.vouched) { // schon im Ticket gevoucht -> keine DM-Anfrage mehr
      const user = await client.users.fetch(t.userId).catch(() => null);
      await user?.send(vouchPrompt(t.label)).catch(() => {});
    }
    setTimeout(() => i.channel.delete().catch(console.error), 5000);
    return;
  }

  if (id === 'afkclaim') {
    const t = db.data.open[i.channelId];
    if (!t) return i.reply({ content: '❌ Ticket nicht gefunden.', ephemeral: true });
    if (!isTeam(i, findService(AFK_ID)?.roleIds ?? [])) return i.reply({ content: '⛔ Nur das AFK-Team kann übernehmen.', ephemeral: true });
    if (t.claimedBy) return i.reply({ content: `Bereits übernommen von <@${t.claimedBy}>.`, ephemeral: true });
    Object.assign(t, { claimedBy: i.user.id, claimedName: i.user.username });
    db.save();
    await i.update({ components: [afkTicketRow(t)] });
    return i.channel.send({ embeds: [embed().setDescription(
      `🙋 ${i.user} hat diesen AFK Service übernommen.\n\n<@${t.userId}> Nach erfolgreichem Service kannst du hier mit **⭐ Vouch abgeben** oder \`/vouch\` für ${i.user} vouchen.`)] });
  }

  if (id === 'afkvouch') {
    const { error } = afkVouchCheck(i);
    if (error) return i.reply({ content: error, ephemeral: true });
    return i.reply({ content: '⭐ Wie zufrieden warst du mit dem AFK Service?', components: [starButtons('afkstar:')], ephemeral: true });
  }

  if (id === 'afkstar') {
    const { error } = afkVouchCheck(i);
    if (error) return i.reply({ content: error, ephemeral: true });
    return i.showModal(modal(`afkvouchm:${arg}`, `AFK-Vouch · ${'⭐'.repeat(+arg)}`,
      input('text', 'Deine Bewertung', TextInputStyle.Paragraph, true, 'Wie lief der AFK Service?')));
  }

  if (id === 'vouch') {
    const [gid, stars, ...l] = rest;
    return i.showModal(modal(`vouchm:${gid}:${stars}:${l.join(':')}`, `Bewertung · ${'⭐'.repeat(+stars)}`,
      input('text', 'Deine Bewertung', TextInputStyle.Paragraph, true, 'Wie lief der Service?')));
  }
}

async function onModal(i) {
  const [id, ...rest] = i.customId.split(':');
  const arg = rest.join(':');
  const f = (k) => i.fields.getTextInputValue(k);

  if (id === 'afkvouchm') {
    const { t, error } = afkVouchCheck(i);
    if (error) return i.reply({ content: error, ephemeral: true });
    const ok = await postVouch({ user: i.user, stars: +arg, text: f('text'), service: `AFK Service · Ticket #${t.number}`, staffId: t.claimedBy, staffName: t.claimedName });
    if (!ok) return i.reply({ content: '❌ Vouch-Kanal nicht gefunden – bitte melde dich beim Team.', ephemeral: true });
    t.vouched = true;
    db.save();
    // Vouch-Button im Ticket läuft aus
    const msg = t.messageId && await i.channel.messages.fetch(t.messageId).catch(() => null);
    await msg?.edit({ components: [afkTicketRow(t)] }).catch(() => {});
    await i.channel.send({ embeds: [embed().setDescription(`⭐ ${i.user} hat für <@${t.claimedBy}> gevoucht (${'⭐'.repeat(+arg)}). Danke!`)] });
    return i.update({ content: '💛 Danke! Dein Vouch wurde im Vouch-Kanal veröffentlicht.', components: [] });
  }

  if (id === 'vouchm') {
    const [, stars, ...l] = rest;
    const ok = await postVouch({ user: i.user, stars: +stars, text: f('text'), service: l.join(':') || BRAND_NAME });
    if (!ok) return i.reply({ content: '❌ Vouch-Kanal nicht gefunden – bitte melde dich beim Team.', ephemeral: true });
    return i.update({ embeds: [embed().setTitle('💛 Danke für deine Bewertung!').setDescription('Sie wurde im Vouch-Kanal veröffentlicht.')], components: [] });
  }

  await i.deferReply({ ephemeral: true });

  if (id === 'supportm') {
    const t = SUPPORT_TOPICS[arg];
    return openTicket(i, {
      kind: 'support', label: `Support · ${t.label}`, prefix: 'support', roleIds: [cfg('SUPPORT_ROLE_ID')],
      info: embed().setDescription(`${t.emoji} **${t.label}**\nEin Supporter meldet sich gleich bei dir.`).addFields(
        { name: 'Minecraft-Name', value: f('ign'), inline: true },
        { name: 'Betreff', value: f('betreff'), inline: true },
        { name: 'Beschreibung', value: f('details') },
      ),
    });
  }

  if (id === 'spawnerset') {
    if (!isTeam(i, cfg('SPAWNER_ROLE_ID'))) return i.editReply('⛔ Nur das Team kann Spawner-Preise ändern.');
    const color = f('color').trim();
    if (color && !/^#[0-9a-f]{6}$/i.test(color)) return i.editReply('❌ Farbe muss so aussehen: `#4caf50`');
    const name = f('name').trim();
    let s = (arg && findSpawner(arg)) || findSpawner(name);
    if (!s) db.data.spawners.push((s = { name, color: '#9e9e9e' }));
    Object.assign(s, { name, get: f('get').trim(), pay: f('pay').trim() }, color && { color });
    db.save();
    await refresh('spawner');
    return i.editReply(`✅ **${name}** aktualisiert – Du erhältst **${s.get}** · Du zahlst **${s.pay}**`);
  }

  if (id === 'servicem') {
    const s = findService(arg);
    if (!s?.enabled) return i.editReply('❌ Dieser Service ist nicht verfügbar.');
    if (s.limit && openCount(s.id) >= s.limit) return i.editReply('🟡 Das Ticket-Limit wurde gerade erreicht.');
    return openTicket(i, {
      kind: 'service', serviceId: s.id, label: s.name, prefix: slug(s.name).slice(0, 20) || 'service', emoji: s.emoji, roleIds: s.roleIds,
      info: embed().setDescription(`${s.emoji} **${s.name}**\nEin Teammitglied meldet sich gleich bei dir.`)
        .addFields({ name: 'Minecraft-Name', value: f('ign') }, { name: 'Anliegen', value: f('details') }),
    });
  }

  if (id === 'afkm') {
    const [pkg, sell] = rest;
    const [tier, up] = pkg.split('-');
    const p = db.data.afkPrices;
    const s = findService(AFK_ID);
    if (s && !s.enabled) return i.editReply('🔴 Der AFK Service ist derzeit pausiert.');
    if (s?.limit && openCount(AFK_ID) >= s.limit) return i.editReply('🟡 Das Ticket-Limit wurde gerade erreicht.');
    const info = embed().setDescription(`💤 **AFK Service · ${afkLabel(pkg)}**\nEin Teammitglied meldet sich gleich bei dir.`).addFields(
      { name: 'Minecraft-Name', value: f('ign'), inline: true },
      { name: 'Uptime', value: `${up} / Tag`, inline: true },
      { name: 'Verkauf', value: AFK_SELL[sell], inline: true },
      { name: 'Preis', value: tier === 'deluxe' ? `${priceOr(p[up])} + ${p.deluxe} + Material` : priceOr(p[up]), inline: true },
      { name: 'Farm-Refill', value: tier === 'deluxe' ? '✅ Ja (Deluxe)' : '❌ Nein', inline: true },
      { name: 'Dauer', value: f('dauer'), inline: true },
      { name: 'Farm / Spawner', value: f('farm') },
    );
    return openTicket(i, {
      kind: 'service', serviceId: AFK_ID, label: `AFK ${afkLabel(pkg)}`, prefix: 'afk',
      roleIds: s?.roleIds ?? [], info,
    });
  }

  if (id === 'customm') {
    const t = CUSTOM_TYPES[arg];
    const price = db.data.customPrices[arg];
    const maps = parseInt(f('maps'), 10);
    const total = parseMoney(price) * maps;
    const info = embed().setDescription(`Custom Map-Art · **${t.label}**\nEin Teammitglied meldet sich gleich bei dir.`).addFields(
      { name: 'Minecraft-Name', value: f('ign'), inline: true },
      { name: 'Anzahl Maps', value: f('maps'), inline: true },
      { name: 'Preis', value: Number.isFinite(total) && total > 0 ? `${price} × ${maps} = **${fmtMoney(total)}**` : `${price} pro Map`, inline: true },
      { name: 'Motiv', value: f('motiv') },
    );
    if (f('notes')) info.addFields({ name: 'Anmerkungen', value: f('notes') });
    return openTicket(i, { kind: 'custom', label: `Custom Map-Art · ${t.label}`, prefix: 'custom', roleIds: [cfg('MAPART_ROLE_ID')], info });
  }

  if (id === 'spawnerm') {
    const buy = arg === 'buy';
    const s = findSpawner(f('type'));
    const price = s && (buy ? s.pay : s.get);
    if (s && isStop(price)) return i.editReply(`⛔ ${s.name}-Spawner ${buy ? 'verkaufen' : 'kaufen'} wir aktuell nicht.`);
    return openTicket(i, {
      kind: `spawner-${arg}`, label: buy ? 'Spawner kaufen' : 'Spawner verkaufen', prefix: 'spawner', emoji: buy ? '🛒' : '💰',
      roleIds: [cfg('SPAWNER_ROLE_ID')],
      info: embed().setDescription('Ein Teammitglied meldet sich gleich bei dir.').addFields(
        { name: 'Minecraft-Name', value: f('ign'), inline: true },
        { name: 'Spawner', value: s?.name ?? f('type'), inline: true },
        { name: 'Anzahl', value: f('amount'), inline: true },
        { name: buy ? 'Du zahlst / Stück' : 'Du erhältst / Stück', value: price ?? 'Wird im Ticket besprochen', inline: true },
      ),
    });
  }
}

async function onAutocomplete(i) {
  const q = i.options.getFocused().toLowerCase();
  const list = i.commandName === 'spawner' ? db.data.spawners.map((s) => ({ name: s.name, value: s.name }))
    : i.commandName === 'ticketkategorie' ? ticketTypes().map((k) => {
      const cat = db.data.categories[k] && i.guild.channels.cache.get(db.data.categories[k]);
      return { name: `${TICKET_TYPES[k] ?? '🎫'} ${k} → ${cat ? cat.name : 'Standard'}`.slice(0, 100), value: k };
    })
    : db.data.services.map((s) => ({ name: `${s.emoji} ${s.name}`, value: s.id }));
  return i.respond(list.filter((o) => o.name.toLowerCase().includes(q)).slice(0, 25));
}

// ---------- Events ----------

// Commands pro Server registrieren (sofort verfügbar) und bestehende Panels neu zeichnen (z. B. neue Buttons)
const setupGuild = (g) => db.run(g.id, async () => {
  await g.commands.set(commands.map((c) => c.toJSON()));
  for (const key of Object.keys(db.data.panels)) if (PANELS[key]) await refresh(key);
  console.log(`  ✅ ${g.name} (${g.id})`);
}).catch((err) => console.error(`  ❌ ${g.name} (${g.id}):`, err.message));

client.once('clientReady', async () => {
  console.log(`${BRAND_NAME} online als ${client.user.tag} – ${client.guilds.cache.size} Server:`);
  for (const g of client.guilds.cache.values()) await setupGuild(g);
  if (!client.guilds.cache.size) {
    console.log(`  Noch auf keinem Server. Einladen: https://discord.com/oauth2/authorize?client_id=${client.user.id}&scope=bot+applications.commands&permissions=8`);
  }
});

// Neu eingeladen -> direkt einrichten
client.on('guildCreate', setupGuild);

client.on('interactionCreate', (i) => {
  // Vouch-Buttons/-Formulare kommen aus DMs: Server-ID steckt in der customId
  const gid = i.guildId ?? (/^vouchm?:/.test(i.customId ?? '') ? i.customId.split(':')[1] : undefined);
  return db.run(gid, () => handleInteraction(i));
});

async function handleInteraction(i) {
  try {
    if (i.isAutocomplete()) return await onAutocomplete(i);
    if (i.isChatInputCommand()) return await onCommand(i);
    if (i.isModalSubmit()) return await onModal(i);
    if (i.isButton() || i.isStringSelectMenu()) return await onComponent(i);
  } catch (err) {
    console.error(err);
    const msg = { content: '❌ Da ist etwas schiefgelaufen.', ephemeral: true };
    if (i.isRepliable()) (i.deferred || i.replied ? i.followUp(msg) : i.reply(msg)).catch(() => {});
  }
}

// Ticket gelöscht (Button oder manuell) -> Zähler freigeben
client.on('channelDelete', (ch) => ch.guildId && db.run(ch.guildId, () => {
  const t = db.data.open[ch.id];
  if (!t) return;
  delete db.data.open[ch.id];
  db.save();
  if (t.serviceId) refresh('service');
}));

// Map-Art- / Shop-Post gelöscht -> Eintrag, Bild und Datei entfernen
client.on('messageDelete', (msg) => msg.guildId && db.run(msg.guildId, () => {
  for (const [key, panel] of [['maparts', 'mapart'], ...Object.entries(SHOPS).map(([k, s]) => [s.store, k])]) {
    const id = Object.keys(db.data[key]).find((k) => db.data[key][k].messageId === msg.id);
    if (!id) continue;
    const { image, file } = db.data[key][id];
    if (image) fs.rm(path.join(web.UPLOADS, image), () => {});
    if (file) fs.rm(path.join(FILES, file), () => {});
    delete db.data[key][id];
    db.save();
    refresh(panel);
  }
}));

web.start();
client.login(env.TOKEN);
module.exports = { PANELS, commands, openTicket, onCommand, onComponent, onModal };
