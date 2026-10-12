const {
  Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, AttachmentBuilder,
  SlashCommandBuilder, PermissionFlagsBits, ChannelType, OverwriteType, Partials,
} = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
const db = require('./db');
const { renderSpawnerPanel } = require('./spawnerImage');
const { isStop, parseMoney, fmtMoney, CUSTOM_TYPES } = require('./util');
const web = require('./web');

const env = process.env;
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
const input = (id, label, style = TextInputStyle.Short, required = true, placeholder) => {
  const t = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required);
  if (placeholder) t.setPlaceholder(placeholder);
  return row(t);
};
const modal = (id, title, ...rows) => new ModalBuilder().setCustomId(id).setTitle(title).addComponents(...rows);
const slug = (s) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
const openCount = (serviceId) => Object.values(db.data.open).filter((t) => t.serviceId === serviceId).length;
const findService = (id) => db.data.services.find((s) => s.id === id);
const findSpawner = (name) => db.data.spawners.find((s) => s.name.toLowerCase() === name.trim().toLowerCase());

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

function spawnerPanel() {
  return {
    content: '',
    embeds: [],
    files: [new AttachmentBuilder(renderSpawnerPanel(db.data.spawners), { name: 'spawner.png' })],
    components: [row(
      new ButtonBuilder().setCustomId('spawner:buy').setLabel('Spawner kaufen').setEmoji('🛒').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('spawner:sell').setLabel('Spawner verkaufen').setEmoji('💰').setStyle(ButtonStyle.Primary),
    )],
  };
}

const PANELS = { service: servicePanel, custom: customPanel, spawner: spawnerPanel };

async function refresh(key) {
  const p = db.data.panels[key];
  if (!p) return;
  const ch = await client.channels.fetch(p.channelId).catch(() => null);
  const msg = await ch?.messages.fetch(p.messageId).catch(() => null);
  if (msg) await msg.edit({ ...PANELS[key](), attachments: [] }).catch(console.error);
}

// ---------- Tickets ----------

async function openTicket(i, { kind, serviceId = null, label, prefix, roleIds = [], extraUserIds = [], info }) {
  const g = i.guild;
  const dup = Object.entries(db.data.open).find(([, t]) => t.userId === i.user.id && t.kind === kind && t.serviceId === serviceId);
  if (dup) return i.editReply(`Du hast bereits ein offenes Ticket: <#${dup[0]}>`);

  const allow = [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles];
  const roles = roleIds.filter((id) => id && g.roles.cache.has(id));
  const extras = [];
  for (const id of extraUserIds) if (id !== i.user.id && (await g.members.fetch(id).catch(() => null))) extras.push(id);

  const ch = await g.channels.create({
    name: `${prefix}-${i.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 90),
    type: ChannelType.GuildText,
    parent: env.TICKET_CATEGORY_ID || null,
    permissionOverwrites: [
      { id: g.roles.everyone.id, deny: [P.ViewChannel] },
      { id: client.user.id, allow: [...allow, P.ManageChannels], type: OverwriteType.Member },
      ...[i.user.id, ...extras].map((id) => ({ id, allow, type: OverwriteType.Member })),
      ...roles.map((id) => ({ id, allow, type: OverwriteType.Role })),
    ],
  });

  db.data.open[ch.id] = { userId: i.user.id, kind, serviceId, label };
  db.save();

  await ch.send({
    content: [i.user, ...extras.map((id) => `<@${id}>`), ...roles.map((id) => `<@&${id}>`)].join(' '),
    embeds: [info.setTitle(`🎫 ${label}`)],
    components: [row(new ButtonBuilder().setCustomId('close').setLabel('Ticket schließen').setEmoji('🔒').setStyle(ButtonStyle.Danger))],
  });
  if (serviceId) refresh('service');
  return i.editReply(`✅ Dein Ticket wurde erstellt: ${ch}`);
}

function vouchPrompt(label) {
  const l = label.slice(0, 60);
  return {
    embeds: [embed().setTitle('⭐ Wie zufrieden warst du?')
      .setDescription(`Danke, dass du das **${BRAND_NAME}** genutzt hast!\n\nBewerte deinen Service **${l}** – deine Bewertung wird im Vouch-Kanal veröffentlicht.`)],
    components: [row(...[1, 2, 3, 4, 5].map((n) =>
      new ButtonBuilder().setCustomId(`vouch:${n}:${l}`).setLabel('⭐'.repeat(n)).setStyle(n >= 4 ? ButtonStyle.Success : ButtonStyle.Secondary)))],
  };
}

// ---------- Commands ----------

const admin = P.ManageGuild;
const commands = [
  new SlashCommandBuilder().setName('panel').setDescription('Panel in diesem Kanal senden').setDefaultMemberPermissions(admin)
    .addStringOption((o) => o.setName('typ').setDescription('Welches Panel?').setRequired(true)
      .addChoices({ name: 'Services', value: 'service' }, { name: 'Custom Map-Art', value: 'custom' }, { name: 'Spawner Handel', value: 'spawner' })),

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

  new SlashCommandBuilder().setName('vouch').setDescription('Bewertung per DM abgeben'),
];

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
    return i.editReply('✅ Map-Art gepostet.');
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

  if (i.commandName === 'vouch') {
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

  if (id === 'custom') {
    const t = CUSTOM_TYPES[i.values[0]];
    return i.showModal(modal(`customm:${i.values[0]}`, `Custom Map-Art · ${t.label}`,
      input('ign', 'Minecraft-Name'),
      input('maps', 'Anzahl Maps', TextInputStyle.Short, true, 'z. B. 4 (für 2x2)'),
      input('motiv', 'Motiv (Bild-Link oder Beschreibung)', TextInputStyle.Paragraph),
      input('notes', 'Anmerkungen', TextInputStyle.Paragraph, false)));
  }

  if (id === 'spawner') {
    const buy = arg === 'buy';
    return i.showModal(modal(`spawnerm:${arg}`, buy ? 'Spawner kaufen' : 'Spawner verkaufen',
      input('ign', 'Minecraft-Name'),
      input('type', 'Spawner-Typ', TextInputStyle.Short, true, db.data.spawners.map((s) => s.name).join(', ').slice(0, 100)),
      input('amount', 'Anzahl', TextInputStyle.Short, true, 'z. B. 3')));
  }

  if (id === 'mapart') {
    const m = db.data.maparts[arg];
    if (!m) return i.reply({ content: '❌ Diese Map-Art ist nicht mehr verfügbar.', ephemeral: true });
    await i.deferReply({ ephemeral: true });
    const info = embed().setDescription(`${i.user} möchte diese Map-Art kaufen.\nEin Teammitglied meldet sich gleich bei dir.`)
      .addFields(
        { name: '🖼️ Map-Art', value: m.name, inline: true },
        { name: '💰 Preis', value: m.price, inline: true },
        { name: '📐 Größe', value: m.size, inline: true },
        { name: '👤 Besitzer', value: `<@${m.ownerId}>${m.thirdParty ? ' · 3T' : ''}`, inline: true },
      );
    const img = i.message.embeds[0]?.image?.url;
    if (img) info.setThumbnail(img);
    return openTicket(i, {
      kind: 'mapart', label: `Map-Art: ${m.name}`, prefix: 'mapart', info,
      roleIds: [env.MAPART_ROLE_ID], extraUserIds: m.thirdParty ? [m.ownerId] : [],
    });
  }

  if (id === 'close') {
    const t = db.data.open[i.channelId];
    await i.reply({ embeds: [embed().setDescription(`🔒 Ticket wird von ${i.user} geschlossen …`)] });
    if (t) {
      const user = await client.users.fetch(t.userId).catch(() => null);
      await user?.send(vouchPrompt(t.label)).catch(() => {});
    }
    setTimeout(() => i.channel.delete().catch(console.error), 5000);
    return;
  }

  if (id === 'vouch') {
    const [stars, ...l] = rest;
    return i.showModal(modal(`vouchm:${stars}:${l.join(':')}`, `Bewertung · ${'⭐'.repeat(+stars)}`,
      input('text', 'Deine Bewertung', TextInputStyle.Paragraph, true, 'Wie lief der Service?')));
  }
}

async function onModal(i) {
  const [id, ...rest] = i.customId.split(':');
  const arg = rest.join(':');
  const f = (k) => i.fields.getTextInputValue(k);

  if (id === 'vouchm') {
    const [stars, ...l] = rest;
    const ch = await client.channels.fetch(env.VOUCH_CHANNEL_ID).catch(() => null);
    if (!ch) return i.reply({ content: '❌ Vouch-Kanal nicht gefunden – bitte melde dich beim Team.', ephemeral: true });
    await ch.send({
      embeds: [embed().setAuthor({ name: i.user.username, iconURL: i.user.displayAvatarURL() })
        .setTitle(`${'⭐'.repeat(+stars)}${'☆'.repeat(5 - stars)}`)
        .setDescription(`>>> ${f('text')}`)
        .addFields({ name: 'Service', value: l.join(':') || BRAND_NAME, inline: true }, { name: 'Kunde', value: `${i.user}`, inline: true })],
    });
    db.data.vouches.push({
      user: i.user.username, avatar: i.user.displayAvatarURL({ size: 64 }), stars: +stars,
      text: f('text'), service: l.join(':') || BRAND_NAME, date: Date.now(),
    });
    db.save();
    return i.update({ embeds: [embed().setTitle('💛 Danke für deine Bewertung!').setDescription('Sie wurde im Vouch-Kanal veröffentlicht.')], components: [] });
  }

  await i.deferReply({ ephemeral: true });

  if (id === 'servicem') {
    const s = findService(arg);
    if (!s?.enabled) return i.editReply('❌ Dieser Service ist nicht verfügbar.');
    if (s.limit && openCount(s.id) >= s.limit) return i.editReply('🟡 Das Ticket-Limit wurde gerade erreicht.');
    return openTicket(i, {
      kind: 'service', serviceId: s.id, label: s.name, prefix: slug(s.name).slice(0, 20) || 'service', roleIds: s.roleIds,
      info: embed().setDescription(`${s.emoji} **${s.name}**\nEin Teammitglied meldet sich gleich bei dir.`)
        .addFields({ name: 'Minecraft-Name', value: f('ign') }, { name: 'Anliegen', value: f('details') }),
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
    return openTicket(i, { kind: 'custom', label: `Custom Map-Art · ${t.label}`, prefix: 'custom', roleIds: [env.MAPART_ROLE_ID], info });
  }

  if (id === 'spawnerm') {
    const buy = arg === 'buy';
    const s = findSpawner(f('type'));
    const price = s && (buy ? s.pay : s.get);
    if (s && isStop(price)) return i.editReply(`⛔ ${s.name}-Spawner ${buy ? 'verkaufen' : 'kaufen'} wir aktuell nicht.`);
    return openTicket(i, {
      kind: `spawner-${arg}`, label: buy ? 'Spawner kaufen' : 'Spawner verkaufen', prefix: buy ? 'spawner-kauf' : 'spawner-verkauf',
      roleIds: [env.SPAWNER_ROLE_ID],
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
  const list = i.commandName === 'spawner'
    ? db.data.spawners.map((s) => ({ name: s.name, value: s.name }))
    : db.data.services.map((s) => ({ name: `${s.emoji} ${s.name}`, value: s.id }));
  return i.respond(list.filter((o) => o.name.toLowerCase().includes(q)).slice(0, 25));
}

// ---------- Events ----------

client.once('ready', async () => {
  const g = await client.guilds.fetch(env.GUILD_ID);
  await g.commands.set(commands.map((c) => c.toJSON()));
  console.log(`${BRAND_NAME} online als ${client.user.tag}`);
});

client.on('interactionCreate', async (i) => {
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
});

// Ticket gelöscht (Button oder manuell) -> Zähler freigeben
client.on('channelDelete', (ch) => {
  const t = db.data.open[ch.id];
  if (!t) return;
  delete db.data.open[ch.id];
  db.save();
  if (t.serviceId) refresh('service');
});

// Map-Art-Post gelöscht (= verkauft) -> auch von der Website nehmen
client.on('messageDelete', (msg) => {
  const id = Object.keys(db.data.maparts).find((k) => db.data.maparts[k].messageId === msg.id);
  if (!id) return;
  const img = db.data.maparts[id].image;
  if (img) fs.rm(path.join(web.UPLOADS, img), () => {});
  delete db.data.maparts[id];
  db.save();
});

web.start();
client.login(env.TOKEN);
