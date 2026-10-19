import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions
} from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { VideoView, useVideoPlayer } from "expo-video";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import * as DocumentPicker from "expo-document-picker";
import { FlashList } from "@shopify/flash-list";

export const hash = (s) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = h * 31 + s.charCodeAt(i) >>> 0;
  return h;
};
export const hueOf = (s) => hash(s) % 360;
export const cleanName = (t) => t.replace(/^[^|]{1,8}\|\s*/, "").trim() || t;
export function normalizeHost(raw) {
  let h = (raw || "").trim();
  if (!h) return "";
  if (!/^https?:\/\//i.test(h)) h = "http://" + h;
  const m = h.match(/^(https?:\/\/[^\/?#\s]+)/i);
  return (m ? m[1] : h).toLowerCase();
}
export function fromGetPhp(link) {
  const u = link.match(/[?&]username=([^&#\s]+)/i);
  const p = link.match(/[?&]password=([^&#\s]+)/i);
  if (!u || !p) return null;
  const dec = (s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  };
  return { host: normalizeHost(link), user: dec(u[1]), pass: dec(p[1]) };
}
const enc = encodeURIComponent;
export const xtreamApi = (base, user, pass, action = "", extra = "") => `${base}/player_api.php?username=${enc(user)}&password=${enc(pass)}${action ? `&action=${action}` : ""}${extra}`;
export const liveUrls = (b, u, p, id) => [
  `${b}/live/${enc(u)}/${enc(p)}/${id}.m3u8`,
  `${b}/live/${enc(u)}/${enc(p)}/${id}.ts`
];
export const movieUrl = (b, u, p, id, ext) => `${b}/movie/${enc(u)}/${enc(p)}/${id}.${ext || "mp4"}`;
export const episodeUrl = (b, u, p, id, ext) => `${b}/series/${enc(u)}/${enc(p)}/${id}.${ext || "mp4"}`;
export function guessKind(cat, title, url) {
  if (/\/series\//i.test(url)) return "serie";
  if (/\/movie\//i.test(url)) return "film";
  if (/\/live\//i.test(url)) return "tv";
  if (/s\d{1,2}\s?e\d{1,3}|saison/i.test(title)) return "serie";
  const g = cat.toLowerCase().replace(/^[^|]{1,8}\|\s*/, "");
  if (/^(films?|movies?|vod)\b/.test(g)) return "film";
  if (/^(s[ée]ries?|shows?|saisons?)\b/.test(g)) return "serie";
  if (/\.(mp4|mkv|avi|mov|m4v|wmv|flv)(\?|$)/i.test(url)) return "film";
  return "tv";
}
export function parseM3U(text, sid) {
  const out = [];
  let cur = null;
  let grp = "";
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim();
    if (!l) continue;
    if (l.startsWith("#EXTINF")) {
      const attrs = {};
      const rest = l.replace(/^#EXTINF:\s*[-\d.]*/, "").replace(/([\w-]+)="([^"]*)"/g, (_m, k, v) => {
        attrs[k.toLowerCase()] = v;
        return "";
      });
      const comma = rest.indexOf(",");
      const title = (comma >= 0 ? rest.slice(comma + 1) : "").trim() || attrs["tvg-name"] || "Sans titre";
      cur = {
        title,
        cat: (attrs["group-title"] || grp || "Divers").trim() || "Divers",
        icon: attrs["tvg-logo"] || void 0
      };
    } else if (l.startsWith("#EXTGRP:")) {
      grp = l.slice(8).trim();
    } else if (!l.startsWith("#") && cur) {
      const url = l.replace(/\|(?:user-agent|referer|origin)=.*$/i, "").trim();
      out.push({
        id: `${sid}:${hash(url)}`,
        sid,
        kind: guessKind(cur.cat, cur.title, url),
        title: cur.title,
        cat: cur.cat,
        hue: hueOf(cur.title),
        icon: cur.icon,
        urls: [url]
      });
      cur = null;
      if (out.length >= 6e4) break;
    }
  }
  return out;
}
export const fmtRating = (r) => {
  const n = parseFloat(String(r));
  return isFinite(n) && n > 0 ? n.toFixed(1) : void 0;
};
export const yearOf = (s) => {
  const y = String(s.year || s.releaseDate || s.releasedate || s.release_date || "").slice(0, 4);
  return /^\d{4}$/.test(y) ? y : void 0;
};
export function mapXtream(sid, base, user, pass, d) {
  const names = (a) => {
    const m = {};
    (a || []).forEach((c) => {
      m[String(c.category_id)] = String(c.category_name || "Divers");
    });
    return m;
  };
  const lcn = names(d.lc);
  const vcn = names(d.vc);
  const scn = names(d.sc);
  const out = [];
  for (const s of d.ls || []) {
    const id = String(s.stream_id);
    const title = String(s.name || "Cha\xEEne");
    out.push({
      id: `${sid}:l:${id}`,
      sid,
      kind: "tv",
      title,
      cat: lcn[String(s.category_id)] || "Divers",
      hue: hueOf(title),
      icon: s.stream_icon || void 0,
      urls: liveUrls(base, user, pass, id)
    });
  }
  for (const s of d.vs || []) {
    const id = String(s.stream_id);
    const title = String(s.name || "Film");
    out.push({
      id: `${sid}:v:${id}`,
      sid,
      kind: "film",
      title,
      cat: vcn[String(s.category_id)] || "Divers",
      hue: hueOf(title),
      icon: s.stream_icon || void 0,
      rating: fmtRating(s.rating),
      year: yearOf(s),
      urls: withFallbacks(movieUrl(base, user, pass, id, s.container_extension)),
      vodId: id
    });
  }
  for (const s of d.ss || []) {
    const id = String(s.series_id);
    const title = String(s.name || "S\xE9rie");
    out.push({
      id: `${sid}:s:${id}`,
      sid,
      kind: "serie",
      title,
      cat: scn[String(s.category_id)] || "Divers",
      hue: hueOf(title),
      icon: s.cover || void 0,
      plot: s.plot || void 0,
      rating: fmtRating(s.rating),
      year: yearOf(s),
      seriesId: id
    });
  }
  return out;
}
export function parseSeriesInfo(base, user, pass, j) {
  const seasons = [];
  const eps = j && j.episodes || {};
  for (const [k, list] of Object.entries(eps)) {
    if (!Array.isArray(list)) continue;
    const key = String((list[0] && list[0].season) ?? k);
    seasons.push({
      key,
      eps: list.map((e, i) => ({
        id: String(e.id),
        season: key,
        num: Number(e.episode_num) || i + 1,
        title: String(e.title || `\xC9pisode ${e.episode_num || i + 1}`),
        dur: e.info && e.info.duration ? String(e.info.duration) : void 0,
        url: episodeUrl(base, user, pass, String(e.id), e.container_extension),
        img: e.info && (e.info.movie_image || e.info.cover_big) || void 0,
        plot: e.info && e.info.plot || void 0
      }))
    });
  }
  seasons.sort((a, b) => Number(a.key) - Number(b.key));
  const bd = j && j.info && j.info.backdrop_path;
  return {
    plot: j && j.info && j.info.plot || void 0,
    backdrop: (Array.isArray(bd) ? bd[0] : typeof bd === "string" ? bd : void 0) || void 0,
    seasons
  };
}
const VOD_EXT = /\.(mkv|mp4|avi|mov|m4v|wmv|flv|ts|webm|mpg|mpeg|m3u8)(\?.*)?$/i;
export function thumb(url, size = "w342") {
  if (!url) return void 0;
  return url.replace(/(image\.tmdb\.org\/t\/p\/)(original|w\d{3,4}(?:_and_h\d{3,4}(?:_[a-z0-9]+)?)?)\//i, `$1${size}/`);
}
export function withFallbacks(url) {
  if (!/\/(movie|series)\//i.test(url)) return [url];
  const base = url.replace(VOD_EXT, "");
  const out = [url];
  for (const ext of ["mp4", "m3u8"]) {
    const u = `${base}.${ext}`;
    if (out.indexOf(u) < 0) out.push(u);
  }
  return out;
}
export function orderForPlatform(urls, ios) {
  if (!ios) return urls;
  const bad = /\.(mkv|avi|wmv|flv|webm|mpg|mpeg|ts)(\?.*)?$/i;
  return urls.filter((u) => !bad.test(u)).concat(urls.filter((u) => bad.test(u)));
}
export const extOf = (u) => {
  const m = u.match(/\.([a-z0-9]{2,5})(\?.*)?$/i);
  return m ? m[1].toLowerCase() : "";
};
export function cleanTitle(t) {
  let s = (t || "").replace(/^\s*\|?[A-Za-z]{2,3}\|\s*/, "");
  s = s.replace(/\s*[\(\[]\s*(FR|VF|VO|VOST|VOSTFR|MULTI|MULTI-?SUB|4K|UHD|HD|FHD)\s*[\)\]]\s*$/i, "");
  return s.trim() || t;
}
const GENERIC_CAT = /^(s[ée]ries?|films?|movies?|vod|shows?)\s+/i;
export function genresOf(cat) {
  let s = (cat || "").replace(/^\s*\|?[A-Za-z]{2,3}\|\s*/, "").trim();
  s = s.replace(GENERIC_CAT, "");
  const cap = (w) => w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w;
  return s.split(/[|\/,]/).map((g) => g.trim()).filter((g) => g && !/^(s[ée]ries?|films?|movies?|vod)$/i.test(g)).map(cap);
}
export function epTitleOf(title) {
  const s = (title || "").replace(/^.*?S\d{1,2}\s?E\d{1,3}\s*[-–:.]*\s*/i, "").trim();
  return s || title;
}
export function fmtDurLabel(d) {
  if (!d) return "";
  const m = String(d).match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
  if (!m) return String(d);
  const a = Number(m[1]);
  const b = Number(m[2]);
  const mins = m[3] !== void 0 ? a * 60 + b : a;
  if (!mins) return "";
  const h = Math.floor(mins / 60);
  return h > 0 ? `${h} h ${p2(mins % 60)} min` : `${mins} min`;
}
export const PROG_MIN_SEC = 20;
export function progState(pos, dur) {
  if (!isFinite(pos) || !isFinite(dur) || dur < 60 || pos < 0) return "none";
  const r = pos / dur;
  if (r >= 0.92 || r >= 0.8 && dur - pos <= 120) return "done";
  if (pos < PROG_MIN_SEC || r < 0.02) return "none";
  return "partial";
}
export const trackOf = (p) => ({ key: p.key, itemId: p.itemId, sid: p.sid, kind: p.kind, title: p.title, label: p.label, epId: p.epId });
export const epLabel = (e) => `S${e.season} E${e.num}`;
export const epTrack = (item, e) => ({
  key: `${item.id}#${e.id}`,
  itemId: item.id,
  sid: item.sid,
  kind: "serie",
  title: item.title,
  label: epLabel(e),
  epId: e.id
});
export function epReq(item, e, map) {
  const t = epTrack(item, e);
  const r = map[t.key];
  return { title: `${cleanTitle(item.title)} \xB7 ${epLabel(e)}`, urls: withFallbacks(e.url), track: t, startAt: r && !r.done ? Math.max(0, r.pos - 3) : 0 };
}
export function filmReq(item, fromStart, map) {
  const r = map[item.id];
  return {
    title: cleanTitle(item.title),
    urls: item.urls || [],
    track: { key: item.id, itemId: item.id, sid: item.sid, kind: "film", title: item.title },
    startAt: !fromStart && r && !r.done ? Math.max(0, r.pos - 3) : 0
  };
}
export function recReq(r) {
  return {
    title: r.label ? `${cleanTitle(r.title)} \xB7 ${r.label}` : cleanTitle(r.title),
    urls: r.urls,
    track: trackOf(r),
    startAt: r.nextUp || r.done ? 0 : Math.max(0, r.pos - 3)
  };
}
export function nextEpisode(seasons, epId) {
  const all = [];
  for (const s of seasons) for (const e of s.eps) all.push(e);
  for (let i = 0; i < all.length; i++) if (all[i].id === epId) return all[i + 1];
  return void 0;
}
export function updateProg(map, track, urls, pos, dur, now, next) {
  const st = progState(pos, dur);
  if (st === "none") return map;
  const out = { ...map };
  for (const k of Object.keys(out)) {
    if (out[k].nextUp && out[k].itemId === track.itemId && k !== track.key) delete out[k];
  }
  if (st === "partial") {
    out[track.key] = { ...track, urls, pos, dur, ts: now };
    return out;
  }
  out[track.key] = { ...track, urls, pos: dur, dur, ts: now, done: true };
  if (next && track.kind === "serie") {
    const ex = out[next.track.key];
    if (!ex) out[next.track.key] = { ...next.track, urls: next.urls, pos: 0, dur: 0, ts: now, nextUp: true };
    else if (!ex.done) out[next.track.key] = { ...ex, ts: now };
  }
  return out;
}
export function markLaunched(map, track, urls, now) {
  const ex = map[track.key];
  if (ex && ex.done) return map;
  const out = { ...map };
  for (const k of Object.keys(out)) {
    if (out[k].nextUp && out[k].itemId === track.itemId && k !== track.key) delete out[k];
  }
  out[track.key] = ex && ex.dur > 0 ? { ...ex, ...track, urls, ts: now } : { ...track, urls, pos: 0, dur: 0, ts: now, ext: true };
  return out;
}
export function markWatched(map, track, urls, now, next) {
  const out = { ...map };
  for (const k of Object.keys(out)) {
    if (out[k].nextUp && out[k].itemId === track.itemId && k !== track.key) delete out[k];
  }
  const ex = map[track.key];
  const dur = ex && ex.dur > 0 ? ex.dur : 1;
  out[track.key] = { ...track, urls, pos: dur, dur, ts: now, done: true };
  if (next && track.kind === "serie") {
    const nx = out[next.track.key];
    if (!nx) out[next.track.key] = { ...next.track, urls: next.urls, pos: 0, dur: 0, ts: now, nextUp: true };
  }
  return out;
}
export function unmarkWatched(map, key) {
  const cur = map[key];
  if (!cur) return map;
  const out = {};
  for (const k of Object.keys(map)) {
    if (k === key) continue;
    if (map[k].nextUp && map[k].itemId === cur.itemId) continue;
    out[k] = map[k];
  }
  return out;
}
export function topRated(items, n = 10, minRated = 3) {
  const rated = [];
  for (const it of items) {
    const r = parseFloat(it.rating);
    if (isFinite(r) && r > 0) rated.push({ it, r });
  }
  if (rated.length < minRated) return [];
  rated.sort((a, b) => b.r - a.r);
  return rated.slice(0, n).map((x) => x.it);
}
export function topViewed(items, views, n = 10) {
  const out = [];
  for (const it of items) {
    const v = views[it.id];
    if (v > 0) out.push({ it, v });
  }
  out.sort((a, b) => b.v - a.v);
  return out.slice(0, n).map((x) => x.it);
}
export function bumpView(views, id) {
  return { ...views, [id]: (views[id] || 0) + 1 };
}
export function continueList(map, limit = 20) {
  const all = Object.keys(map).map((k) => map[k]).filter((p) => !p.done).sort((a, b) => b.ts - a.ts);
  const seen = {};
  const out = [];
  for (const p of all) {
    if (seen[p.itemId]) continue;
    seen[p.itemId] = true;
    out.push(p);
    if (out.length >= limit) break;
  }
  return out;
}
export const latestForItem = (map, itemId) => continueList(map, 1e5).find((p) => p.itemId === itemId);
export function removeFromContinue(map, itemId) {
  const out = {};
  for (const k of Object.keys(map)) if (!(map[k].itemId === itemId && !map[k].done)) out[k] = map[k];
  return out;
}
export function dropSource(map, sid) {
  const out = {};
  for (const k of Object.keys(map)) if (map[k].sid !== sid) out[k] = map[k];
  return out;
}
const p2 = (n) => (n < 10 ? "0" : "") + n;
export function fmtClock(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor(s % 3600 / 60);
  return h > 0 ? `${h}:${p2(m)}:${p2(s % 60)}` : `${m}:${p2(s % 60)}`;
}
export const remainingLabel = (pos, dur) => `${Math.max(1, Math.round((dur - pos) / 60))} min restantes`;
async function fetchText(url, ms = 9e4) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { signal: ac.signal });
    if (!r.ok) throw new Error(`Le serveur a r\xE9pondu ${r.status}.`);
    return await r.text();
  } catch (e) {
    if (e && e.name === "AbortError") throw new Error("Le serveur met trop de temps \xE0 r\xE9pondre.");
    if (e instanceof Error && e.message.startsWith("Le serveur")) throw e;
    throw new Error("Connexion impossible. V\xE9rifie l'adresse et ta connexion internet.");
  } finally {
    clearTimeout(t);
  }
}
async function fetchJson(url, ms) {
  const t = await fetchText(url, ms);
  try {
    return JSON.parse(t);
  } catch {
    throw new Error("R\xE9ponse inattendue : ce serveur ne semble pas \xEAtre un serveur Xtream.");
  }
}
async function probeUrl(url) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 12e3);
  try {
    const r = await fetch(url, { method: "HEAD", signal: ac.signal });
    const ct = r.headers && r.headers.get && r.headers.get("content-type") || "";
    return `HTTP ${r.status}${ct ? " \xB7 " + ct.split(";")[0] : ""}`;
  } catch (e) {
    return e && e.name === "AbortError" ? "pas de r\xE9ponse (d\xE9lai d\xE9pass\xE9)" : "connexion impossible";
  } finally {
    clearTimeout(t);
  }
}
async function xtreamLogin(base, user, pass) {
  const j = await fetchJson(xtreamApi(base, user, pass), 3e4);
  const ui = j && j.user_info;
  if (!ui) throw new Error("R\xE9ponse inattendue : ce serveur ne semble pas \xEAtre un serveur Xtream.");
  if (String(ui.auth) === "0") throw new Error("Identifiant ou mot de passe refus\xE9.");
  const st = String(ui.status || "Active");
  if (st !== "Active") throw new Error(st === "Expired" ? "Abonnement expir\xE9." : `Compte ${st}.`);
  const exp = Number(ui.exp_date);
  const parts = ["Actif", exp > 0 ? `expire le ${new Date(exp * 1e3).toLocaleDateString("fr-FR")}` : "sans date limite"];
  if (ui.max_connections) parts.push(`${ui.active_cons || 0}/${ui.max_connections} connexions`);
  return parts.join(" \xB7 ");
}
async function loadXtream(s) {
  const base = s.host;
  const u = s.user;
  const p = s.pass;
  let step = "connexion au compte";
  try {
    const info = await xtreamLogin(base, u, p);
    step = "t\xE9l\xE9chargement du catalogue";
    let lastErr = null;
    const one = async (a) => {
      try {
        const j = await fetchJson(xtreamApi(base, u, p, a), 18e4);
        return Array.isArray(j) ? j : [];
      } catch (e) {
        lastErr = e;
        return [];
      }
    };
    const items = [];
    const add = (list) => {
      for (let i = 0; i < list.length; i++) items.push(list[i]);
    };
    add(mapXtream(s.id, base, u, p, { lc: await one("get_live_categories"), ls: await one("get_live_streams") }));
    step = "lecture des films";
    add(mapXtream(s.id, base, u, p, { vc: await one("get_vod_categories"), vs: await one("get_vod_streams") }));
    step = "lecture des s\xE9ries";
    add(mapXtream(s.id, base, u, p, { sc: await one("get_series_categories"), ss: await one("get_series") }));
    step = "lecture du catalogue";
    if (!items.length && lastErr) throw lastErr;
    if (!items.length) throw new Error("Le compte est valide mais aucun contenu n'a \xE9t\xE9 renvoy\xE9.");
    return { items, info: `${info} \xB7 ${items.length} entr\xE9es` };
  } catch (e) {
    const m = e && e.message ? e.message : String(e);
    throw new Error(`${m} [\xE9tape : ${step}]`);
  }
}
const SK = "p4k-sources";
async function readSources() {
  try {
    const v = await SecureStore.getItemAsync(SK);
    if (v) return JSON.parse(v);
  } catch {
  }
  try {
    const v = await AsyncStorage.getItem(SK);
    if (v) return JSON.parse(v);
  } catch {
  }
  return [];
}
async function writeSources(list) {
  const v = JSON.stringify(list);
  try {
    await SecureStore.setItemAsync(SK, v);
    await AsyncStorage.removeItem(SK);
    return;
  } catch {
  }
  try {
    await AsyncStorage.setItem(SK, v);
    await SecureStore.deleteItemAsync(SK);
  } catch {
  }
}
const C = {
  bg: "#000000",
  surface: "#1c1c1e",
  surface2: "#2c2c2e",
  fg: "#ffffff",
  muted: "#8e8e93",
  accent: "#3d8bff",
  accent2: "#5b5bf0",
  gold: "#ffcf5a",
  line: "rgba(255,255,255,0.14)",
  glass: "rgba(38,38,42,0.72)",
  danger: "#ff5d5d"
};
const T = ({ style, ...p }) => <Text {...p} style={[{ color: C.fg }, style]} />;
const hsl = (h, s, l) => `hsl(${h}, ${s}%, ${l}%)`;
const KIND_LABEL = { tv: "TV", film: "Film", serie: "S\xE9rie" };
const TITLES = {
  home: "Tendances V.O.D.",
  tv: "TV en direct",
  film: "Films",
  serie: "S\xE9ries",
  list: "Ma liste"
};
function Poster({ item, w, onPress }) {
  return <Pressable onPress={onPress} style={{ width: w }}>
      <View style={[styles.poster, { width: w }]}>
        <LinearGradient
          colors={[hsl(item.hue, 58, 42), hsl((item.hue + 45) % 360, 62, 15)]}
          start={{ x: 0.2, y: 0 }}
          end={{ x: 0.8, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        {item.icon ? <Image source={{ uri: thumb(item.icon, "w342") }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
        {!item.icon ? <T style={styles.posterTitle} numberOfLines={4}>
            {cleanTitle(item.title)}
          </T> : null}
        <View style={styles.badge}>
          <T style={styles.badgeTxt}>{item.rating || KIND_LABEL[item.kind]}</T>
        </View>
      </View>
      <T style={styles.cap} numberOfLines={1}>
        {cleanTitle(item.title)}
      </T>
      <T style={styles.capSub} numberOfLines={1}>
        {item.year ? `${item.cat} \xB7 ${item.year}` : item.cat}
      </T>
    </Pressable>;
}
function Channel({ item, w, onPress }) {
  return <Pressable onPress={onPress} style={[styles.ch, { width: w }]}>
      <View style={styles.live}>
        <T style={styles.liveTxt}>DIRECT</T>
      </View>
      <View style={styles.logo}>
        {item.icon ? <Image source={{ uri: thumb(item.icon, "w185") }} style={{ width: 70, height: 70 }} resizeMode="contain" /> : <Text style={[styles.logoTxt, { color: hsl(item.hue, 70, 36) }]} numberOfLines={1} adjustsFontSizeToFit>
            {cleanName(item.title).slice(0, 7).toUpperCase()}
          </Text>}
      </View>
      <T style={styles.chName} numberOfLines={1}>
        {item.title}
      </T>
      <T style={styles.chSub} numberOfLines={1}>
        {item.cat}
      </T>
    </Pressable>;
}
const Card = React.memo(function Card2({ item, w, onOpen }) {
  return item.kind === "tv" ? <Channel item={item} w={w} onPress={() => onOpen(item)} /> : <Poster item={item} w={w} onPress={() => onOpen(item)} />;
});
function Rail({ title, data, onOpen }) {
  if (!data.length) return null;
  const tv = data[0].kind === "tv";
  return <View style={{ marginTop: 34 }}>
      <View style={{ paddingHorizontal: 16, marginBottom: 18 }}>
        <T style={styles.h2}>{title}</T>
        <LinearGradient colors={[C.accent2, C.accent]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.underline} />
      </View>
      <FlashList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={data}
        ItemSeparatorComponent={() => <View style={{ width: 14 }} />}
                keyExtractor={(i) => i.id}
        contentContainerStyle={{ paddingHorizontal: 16 }}
        renderItem={({ item }) => <Card item={item} w={tv ? 212 : 138} onOpen={onOpen} />}
      />
    </View>;
}
function ContinueRail({
  entries,
  onPlay,
  onRemove
}) {
  if (!entries.length) return null;
  return <View style={{ marginTop: 28 }}>
      <View style={{ paddingHorizontal: 16, marginBottom: 18 }}>
        <T style={styles.h2}>Reprendre la lecture</T>
        <LinearGradient colors={[C.accent2, C.accent]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.underline} />
      </View>
      <FlashList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={entries}
        ItemSeparatorComponent={() => <View style={{ width: 14 }} />}
                keyExtractor={(e) => e.rec.key}
        contentContainerStyle={{ paddingHorizontal: 16 }}
        renderItem={({ item: { rec, item } }) => {
          const pct = rec.dur > 0 ? rec.pos / rec.dur : 0;
          const sub = rec.ext ? `Dans VLC${rec.label ? " \xB7 " + rec.label : ""}` : rec.nextUp ? `\xC0 suivre \xB7 ${rec.label}` : rec.label ? `${rec.label} \xB7 ${remainingLabel(rec.pos, rec.dur)}` : remainingLabel(rec.pos, rec.dur);
          return <Pressable onPress={() => onPlay(rec)} style={{ width: 232 }}>
              <View style={styles.cwBox}>
                <LinearGradient
                  colors={[hsl(item.hue, 58, 42), hsl((item.hue + 45) % 360, 62, 15)]}
                  start={{ x: 0.2, y: 0 }}
                  end={{ x: 0.8, y: 1 }}
                  style={StyleSheet.absoluteFill}
                />
                {item.icon ? <Image source={{ uri: thumb(item.icon, "w500") }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
                <LinearGradient colors={["transparent", "rgba(0,0,0,0.7)"]} style={StyleSheet.absoluteFill} />
                {!item.icon ? <T style={styles.cwTitle} numberOfLines={3}>
                    {cleanTitle(item.title)}
                  </T> : null}
                <View style={styles.cwPlay}>
                  <Ionicons name="play" size={22} color="#fff" />
                </View>
                <Pressable onPress={() => onRemove(rec.itemId)} style={styles.cwX} hitSlop={8} accessibilityLabel="Retirer de la liste">
                  <Ionicons name="close" size={16} color="#fff" />
                </Pressable>
                {!rec.nextUp ? <View style={styles.cwBar}>
                    <View style={[styles.pfill, { width: `${Math.round(Math.min(1, pct) * 100)}%` }]} />
                  </View> : null}
              </View>
              <T style={styles.cap} numberOfLines={1}>
                {cleanTitle(item.title)}
              </T>
              <T style={styles.capSub} numberOfLines={1}>
                {sub}
              </T>
            </Pressable>;
        }}
      />
    </View>;
}
function Hero({ items, width, onOpen }) {
  const [x, setX] = useState(0);
  const n = items.length;
  const h = Math.round(width * 0.75);
  const bar = 130;
  const seg = bar / n;
  const p = n > 1 ? Math.min(1, Math.max(0, x / (width * (n - 1)))) : 0;
  return <View style={{ width, height: h, borderRadius: 28, overflow: "hidden", backgroundColor: "#000" }}>
      <FlashList
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        data={items}
                keyExtractor={(i) => i.id}
        onScroll={(e) => setX(e.nativeEvent.contentOffset.x)}
        scrollEventThrottle={16}
        renderItem={({ item, index }) => <Pressable onPress={() => onOpen(item)} style={{ width, height: h }}>
            <LinearGradient
              colors={[hsl(item.hue, 62, 44), hsl((item.hue + 40) % 360, 66, 16)]}
              start={{ x: 0.2, y: 0 }}
              end={{ x: 0.8, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            {item.icon ? <Image source={{ uri: thumb(item.icon, "w780") }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
            <LinearGradient colors={["transparent", "rgba(0,0,0,0.25)", "#000"]} locations={[0.35, 0.7, 1]} style={StyleSheet.absoluteFill} />
            <View style={styles.kind}>
              <Ionicons name="play-circle-outline" size={22} color="#fff" />
              <T style={styles.kindTxt}>{KIND_LABEL[item.kind]}</T>
            </View>
            <T style={styles.rank}>{index + 1}</T>
            {!item.icon ? <View style={styles.art}>
                <T style={styles.artTitle} numberOfLines={3}>
                  {cleanTitle(item.title).toUpperCase()}
                </T>
                <T style={styles.artSub}>{item.cat.toUpperCase()}</T>
              </View> : null}
          </Pressable>}
      />
      <View style={styles.hbar}>
        <View style={{ position: "absolute", left: p * (bar - seg), width: seg, height: 6, borderRadius: 3, backgroundColor: C.accent }} />
      </View>
    </View>;
}
const DOCK = [
  ["home", "Accueil", "home"],
  ["tv", "TV en direct", "tv"],
  ["film", "Films", "film"],
  ["serie", "S\xE9ries", "albums"]
];
function Dock({ tab, onTab, onSearch }) {
  const insets = useSafeAreaInsets();
  return <View style={[styles.dock, { bottom: insets.bottom + 10 }]} pointerEvents="box-none">
      <View style={styles.pill}>
        {DOCK.map(([k, label, icon]) => {
          const on = tab === k;
          return <Pressable key={k} onPress={() => onTab(k)} style={[styles.tabBtn, on && styles.tabOn]}>
              <Ionicons name={on ? icon : `${icon}-outline`} size={24} color={on ? C.accent : C.fg} />
              <Text style={{ color: on ? C.accent : C.fg, fontSize: 10.5, fontWeight: on ? "600" : "500" }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                {label}
              </Text>
            </Pressable>;
        })}
      </View>
      <Pressable onPress={onSearch}>
        <View style={styles.srch}>
          <Ionicons name="search" size={28} color={C.fg} />
        </View>
      </Pressable>
    </View>;
}
function PlayerModal({
  req,
  next,
  onProgress,
  onNext,
  onVlc,
  onClose
}) {
  const insets = useSafeAreaInsets();
  const [idx, setIdx] = useState(0);
  const [showNext, setShowNext] = useState(false);
  const url = req.urls[idx];
  const source = useMemo(() => /\.m3u8(\?|$)/i.test(url) ? { uri: url, contentType: "hls" } : { uri: url }, [url]);
  const player = useVideoPlayer(source, (p) => {
    p.play();
  });
  const [st, setSt] = useState({ status: player.status });
  useEffect(() => {
    setSt({ status: player.status });
    const sub = player.addListener("statusChange", (e) => setSt({ status: e.status, error: e.error }));
    return () => {
      try {
        sub.remove();
      } catch {
      }
    };
  }, [player]);
  const status = st.status;
  const error = st.error;
  const failed = status === "error";
  const lastIdx = idx >= req.urls.length - 1;
  const last = useRef({ pos: 0, dur: 0 });
  const nextRef = useRef(next);
  nextRef.current = next;
  const seeked = useRef(false);
  useEffect(() => {
    if (failed && !lastIdx) {
      seeked.current = false;
      setIdx((i) => i + 1);
    }
  }, [failed, lastIdx]);
  const [probe, setProbe] = useState(null);
  const probed = useRef(false);
  useEffect(() => {
    if (!(failed && lastIdx) || probed.current) return;
    probed.current = true;
    let dead = false;
    Promise.all(req.urls.map((u) => probeUrl(u))).then((r) => {
      if (!dead) setProbe(r.map((x, i) => `${extOf(req.urls[i]) || "flux"} \u2192 ${x}`));
    });
    return () => {
      dead = true;
    };
  }, [failed, lastIdx, req.urls]);
  useEffect(() => {
    if (status === "readyToPlay" && !seeked.current) {
      seeked.current = true;
      if (req.startAt && req.startAt > 5) {
        try {
          player.currentTime = req.startAt;
        } catch {
        }
      }
    }
  }, [status, player, req.startAt]);
  useEffect(() => {
    if (!req.track) return;
    const track = req.track;
    let n = 0;
    const id = setInterval(() => {
      n++;
      try {
        const pos = player.currentTime;
        const dur = player.duration;
        if (isFinite(pos) && isFinite(dur) && dur > 0) {
          last.current = { pos, dur };
          const near = dur - pos <= 45 || pos / dur >= 0.95;
          setShowNext((v) => v === near ? v : near);
          if (n % 5 === 0) onProgress(track, req.urls, pos, dur, false, nextRef.current);
        }
      } catch {
      }
    }, 1e3);
    return () => clearInterval(id);
  }, [player, req.track, req.urls, onProgress]);
  const saveNow = (atEnd) => {
    if (!req.track) return;
    const { pos, dur } = last.current;
    if (dur > 0) onProgress(req.track, req.urls, atEnd ? dur : pos, dur, true, nextRef.current);
  };
  const close = () => {
    saveNow(false);
    onClose();
  };
  const goNext = () => {
    saveNow(true);
    onNext();
  };
  return <Modal visible animationType="fade" presentationStyle="fullScreen" onRequestClose={close} supportedOrientations={["portrait", "landscape"]}>
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        <VideoView style={{ flex: 1 }} player={player} nativeControls contentFit="contain" fullscreenOptions={{ enable: true }} />
        <View style={[styles.pTop, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
          <Pressable onPress={close} style={styles.ib} accessibilityLabel="Fermer">
            <Ionicons name="close" size={24} color="#fff" />
          </Pressable>
          <T style={styles.pTitle} numberOfLines={1}>
            {req.title}
          </T>
          <View style={{ width: 44 }} />
        </View>
        {status === "loading" ? <View style={styles.center} pointerEvents="none">
            <ActivityIndicator color="#fff" size="large" />
          </View> : null}
        {showNext && next && !failed ? <Pressable onPress={goNext} style={[styles.nextBtn, { bottom: insets.bottom + 110 }]} accessibilityLabel="Épisode suivant">
            <Ionicons name="play-skip-forward" size={18} color="#000" />
            <Text style={{ color: "#000", fontWeight: "700", fontSize: 15 }}>Épisode suivant</Text>
          </Pressable> : null}
        {failed && lastIdx ? <View style={styles.center}>
            <View style={styles.errBox}>
              <T style={{ fontWeight: "700", fontSize: 17, textAlign: "center" }}>Lecture impossible</T>
              <T style={{ color: C.muted, textAlign: "center" }}>
                {error && error.message || "Le flux ne r\xE9pond pas ou son format n\u2019est pas pris en charge."}
              </T>
              {req.urls.length > 1 ? <T style={{ color: C.muted, textAlign: "center", fontSize: 12 }}>Formats essayés : {req.urls.map(extOf).join(", ")}</T> : null}
              {probe ? <View style={{ gap: 2 }}>
                  <T style={{ color: C.muted, textAlign: "center", fontSize: 12 }}>Réponse du serveur :</T>
                  {probe.map((l) => <T key={l} style={{ color: C.muted, textAlign: "center", fontSize: 12 }}>
                      {l}
                    </T>)}
                </View> : null}
              {Platform.OS === "ios" && req.urls.some((u) => /\.mkv(\?|$)/i.test(u)) ? <T style={{ color: C.muted, textAlign: "center", fontSize: 12 }}>
                  L'iPhone ne lit pas le MKV. Si ton serveur ne propose pas ce contenu en MP4 ou en HLS, il ne pourra pas se lire dans cette version.
                </T> : null}
              <Pressable
                style={styles.btnPri}
                onPress={() => {
                  seeked.current = false;
                  if (idx !== 0) setIdx(0);
                  else player.replaceAsync(source).then(() => player.play()).catch(() => {
                  });
                }}
              >
                <T style={styles.btnTxt}>Réessayer</T>
              </Pressable>
              {Platform.OS === "ios" ? <Pressable
                style={styles.btnSec}
                onPress={() => onVlc(req)}
              >
                  <T style={styles.btnTxt}>Ouvrir dans VLC</T>
                </Pressable> : null}
            </View>
          </View> : null}
      </View>
    </Modal>;
}
function ProgressBar({ pct }) {
  return <View style={styles.pbar}>
      <View style={[styles.pfill, { width: `${Math.round(Math.min(1, Math.max(0, pct)) * 100)}%` }]} />
    </View>;
}
function DetailModal({
  item,
  source,
  fav,
  prog,
  similar,
  loadSeasons,
  onFav,
  onPlay,
  onOpen,
  onMark,
  onClose
}) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const isSeries = !!item.seriesId;
  const [plot, setPlot] = useState(item.plot);
  const [backdrop, setBackdrop] = useState();
  const [dur, setDur] = useState();
  const [seasons, setSeasons] = useState([]);
  const [sel, setSel] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState(isSeries ? "eps" : "sim");
  const [more, setMore] = useState(false);
  useEffect(() => {
    let dead = false;
    if (isSeries) {
      setBusy(true);
      loadSeasons(item).then((r) => {
        if (dead) return;
        setSeasons(r.seasons);
        if (r.plot) setPlot(r.plot);
        if (r.backdrop) setBackdrop(r.backdrop);
        if (!r.seasons.length) setErr("Aucun \xE9pisode disponible pour cette s\xE9rie.");
      }).catch((e) => !dead && setErr(e.message)).finally(() => !dead && setBusy(false));
    } else if (item.vodId && source && source.type === "xtream") {
      fetchJson(xtreamApi(source.host, source.user, source.pass, "get_vod_info", `&vod_id=${item.vodId}`), 3e4).then((j) => {
        if (dead || !j || !j.info) return;
        if (j.info.plot) setPlot(String(j.info.plot));
        if (j.info.duration) setDur(fmtDurLabel(String(j.info.duration)));
        const bd = Array.isArray(j.info.backdrop_path) ? j.info.backdrop_path[0] : j.info.backdrop_path;
        if (bd) setBackdrop(String(bd));
      }).catch(() => {
      });
    }
    return () => {
      dead = true;
    };
  }, [item, source, isSeries, loadSeasons]);
  const eps = seasons[sel] ? seasons[sel].eps : [];
  const genres = genresOf(item.cat);
  const art = item.icon || backdrop;
  const heroH = Math.round(Math.min(width * 1.18, height * 0.6));
  const gridW = (width - 32 - 24) / 3;
  const filmRec = !isSeries ? prog[item.id] : void 0;
  const resumeFilm = filmRec && !filmRec.done && filmRec.pos > 0 ? filmRec : void 0;
  const serRec = isSeries ? latestForItem(prog, item.id) : void 0;
  const firstEp = seasons[0] && seasons[0].eps[0];
  let primary = null;
  if (!isSeries && item.urls) {
    primary = { label: resumeFilm ? `Reprendre \xB7 ${fmtClock(resumeFilm.pos)}` : "Lecture", run: () => onPlay(filmReq(item, false, prog)) };
  } else if (isSeries && serRec) {
    primary = {
      label: serRec.nextUp ? `Lecture ${serRec.label}` : serRec.ext ? `Continuer ${serRec.label}` : `Reprendre ${serRec.label} \xB7 ${fmtClock(serRec.pos)}`,
      run: () => onPlay(recReq(serRec))
    };
  } else if (isSeries && firstEp) {
    primary = { label: `Lecture ${epLabel(firstEp)}`, run: () => onPlay(epReq(item, firstEp, prog)) };
  }
  return <View style={[StyleSheet.absoluteFill, { backgroundColor: C.bg }]}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}>
        <View style={{ height: heroH, backgroundColor: C.surface }}>
          <LinearGradient colors={[hsl(item.hue, 60, 40), hsl((item.hue + 50) % 360, 62, 12)]} style={StyleSheet.absoluteFill} />
          {art ? <Image source={{ uri: thumb(art, "w780") }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
          <LinearGradient colors={["rgba(0,0,0,0.5)", "transparent"]} locations={[0, 0.35]} style={StyleSheet.absoluteFill} />
          <LinearGradient colors={["transparent", C.bg]} locations={[0.5, 1]} style={StyleSheet.absoluteFill} />
          <Pressable onPress={onClose} style={[styles.ib, { position: "absolute", top: insets.top + 8, left: 16 }]} accessibilityLabel="Fermer">
            <Ionicons name="chevron-down" size={26} color="#fff" />
          </Pressable>
        </View>

        <View style={{ paddingHorizontal: 16, gap: 14, marginTop: -64 }}>
          <T style={styles.dTitle}>{cleanTitle(item.title)}</T>
          <View style={styles.metaRow}>
            {item.rating ? <T style={{ color: "#5ad18a", fontWeight: "700" }}>★ {item.rating}</T> : null}
            {item.year ? <T style={styles.metaTxt}>{item.year}</T> : null}
            {isSeries && seasons.length ? <T style={styles.metaTxt}>
                {seasons.length} saison{seasons.length > 1 ? "s" : ""}
              </T> : null}
            {dur ? <T style={styles.metaTxt}>{dur}</T> : null}
          </View>
          {genres.length ? <T style={styles.metaTxt}>{genres.join(" \xB7 ")}</T> : null}

          {primary ? <Pressable style={styles.btnWhite} onPress={primary.run}>
              <Ionicons name="play" size={22} color="#000" />
              <Text style={styles.btnWhiteTxt}>{primary.label}</Text>
            </Pressable> : isSeries && busy ? <View style={[styles.btnWhite, { opacity: 0.5 }]}>
              <ActivityIndicator color="#000" />
            </View> : null}
          {resumeFilm ? <Pressable style={styles.btnGrey} onPress={() => onPlay(filmReq(item, true, prog))}>
              <Ionicons name="refresh" size={18} color="#fff" />
              <T style={styles.btnTxt}>Depuis le début</T>
            </Pressable> : null}
          {resumeFilm && resumeFilm.dur > 0 ? <View style={{ gap: 6 }}>
              <ProgressBar pct={resumeFilm.pos / resumeFilm.dur} />
              <T style={{ color: C.muted, fontSize: 12 }}>{remainingLabel(resumeFilm.pos, resumeFilm.dur)}</T>
            </View> : null}

          {plot ? <Pressable onPress={() => setMore((v) => !v)}>
              <T style={{ lineHeight: 21, color: "#d6d6db" }} numberOfLines={more ? void 0 : 4}>
                {plot}
              </T>
              {plot.length > 180 ? <T style={{ color: C.muted, marginTop: 4, fontWeight: "600" }}>{more ? "Moins" : "Plus"}</T> : null}
            </Pressable> : null}

          <View style={styles.actRow}>
            {!isSeries && item.urls ? <Pressable
              onPress={() => onMark({ key: item.id, itemId: item.id, sid: item.sid, kind: "film", title: item.title }, item.urls, null, !(filmRec && filmRec.done))}
              style={styles.act}
              accessibilityLabel="Marquer comme vu"
            >
                <Ionicons name={filmRec && filmRec.done ? "checkmark-circle" : "eye-outline"} size={28} color={filmRec && filmRec.done ? "#5ad18a" : "#fff"} />
                <T style={styles.actTxt}>{filmRec && filmRec.done ? "Vu" : "Marquer vu"}</T>
              </Pressable> : null}
            <Pressable onPress={onFav} style={styles.act} accessibilityLabel="Ma liste">
              <Ionicons name={fav ? "checkmark" : "add"} size={28} color="#fff" />
              <T style={styles.actTxt}>Ma liste</T>
            </Pressable>
          </View>

          {isSeries ? <View style={styles.dtabs}>
              {[
                ["eps", "\xC9pisodes"],
                ["sim", "Titres similaires"]
              ].map(([k, l]) => <Pressable key={k} onPress={() => setTab(k)} style={[styles.dtab, tab === k && styles.dtabOn]}>
                  <T style={{ fontWeight: "700", fontSize: 15, color: tab === k ? "#fff" : C.muted }}>{l}</T>
                </Pressable>)}
            </View> : <T style={{ fontSize: 18, fontWeight: "700", marginTop: 6 }}>Titres similaires</T>}

          {isSeries && tab === "eps" ? <View style={{ gap: 14 }}>
              {seasons.length > 1 ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                  {seasons.map((s, i) => <Pressable key={s.key} onPress={() => setSel(i)} style={[styles.chip, sel === i && styles.chipOn]}>
                      <T style={{ fontWeight: sel === i ? "700" : "500", color: sel === i ? "#fff" : C.muted }}>Saison {s.key}</T>
                    </Pressable>)}
                </ScrollView> : null}
              {busy ? <ActivityIndicator color={C.accent} style={{ marginTop: 12 }} /> : null}
              {err ? <T style={{ color: C.danger }}>{err}</T> : null}
              {eps.map((e) => {
                const r = prog[`${item.id}#${e.id}`];
                const pct = r && !r.done && r.dur > 0 ? r.pos / r.dur : 0;
                const own = e.img || backdrop || item.icon;
                return <Pressable key={e.id} onPress={() => onPlay(epReq(item, e, prog))} style={{ gap: 8 }}>
                    <View style={styles.epRow}>
                      <View style={styles.epThumb}>
                        <LinearGradient colors={[hsl((item.hue + e.num * 17) % 360, 55, 30), hsl((item.hue + 40 + e.num * 17) % 360, 60, 12)]} style={StyleSheet.absoluteFill} />
                        {own ? <Image source={{ uri: thumb(own, "w342") }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
                        <View style={styles.epPlay}>
                          <Ionicons name="play" size={18} color="#fff" />
                        </View>
                        {!e.img ? <Text style={styles.epNum}>{e.num}</Text> : null}
                        {pct > 0 ? <View style={styles.cwBar}>
                            <View style={[styles.pfill, { width: `${Math.round(Math.min(1, pct) * 100)}%` }]} />
                          </View> : null}
                      </View>
                      <View style={{ flex: 1, gap: 3 }}>
                        <T style={{ fontWeight: "700", fontSize: 16 }} numberOfLines={2}>
                          {e.num}. {epTitleOf(e.title)}
                        </T>
                        <T style={{ color: C.muted, fontSize: 13 }}>{fmtDurLabel(e.dur)}</T>
                      </View>
                      <Pressable
                        hitSlop={10}
                        onPress={() => {
                          const nx = nextEpisode(seasons, e.id);
                          onMark(epTrack(item, e), withFallbacks(e.url), nx ? { track: epTrack(item, nx), urls: withFallbacks(nx.url) } : null, !(r && r.done));
                        }}
                        accessibilityLabel="Marquer comme vu"
                      >
                        <Ionicons name={r && r.done ? "checkmark-circle" : "ellipse-outline"} size={24} color={r && r.done ? "#5ad18a" : C.muted} />
                      </Pressable>
                    </View>
                    {e.plot ? <T style={{ color: C.muted, fontSize: 13, lineHeight: 18 }} numberOfLines={3}>
                        {e.plot}
                      </T> : null}
                  </Pressable>;
              })}
            </View> : <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
              {similar.length ? similar.map((s) => <Poster key={s.id} item={s} w={gridW} onPress={() => onOpen(s)} />) : <T style={{ color: C.muted }}>Aucun titre similaire dans ta bibliothèque.</T>}
            </View>}
        </View>
      </ScrollView>
    </View>;
}
function Field(props) {
  return <TextInput placeholderTextColor={C.muted} autoCapitalize="none" autoCorrect={false} {...props} style={styles.input} />;
}
function SourcesModal({
  sources,
  status,
  onAdd,
  onRemove,
  onRefresh,
  onClose
}) {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState("xtream");
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [ok, setOk] = useState(false);
  const done = (m, good = false) => {
    setMsg(m);
    setOk(good);
    setBusy(false);
  };
  const reset = () => {
    setName("");
    setHost("");
    setUser("");
    setPass("");
    setUrl("");
  };
  const newId = () => "s" + Date.now().toString(36);
  const addXtream = async (h, u, p, label) => {
    const base = normalizeHost(h);
    if (!base || !u.trim() || !p.trim()) return done("Remplis le serveur, l\u2019identifiant et le mot de passe.");
    setBusy(true);
    setMsg("V\xE9rification du compte\u2026");
    try {
      const info = await xtreamLogin(base, u.trim(), p.trim());
      await onAdd({ id: newId(), name: label.trim() || base.replace(/^https?:\/\//, ""), type: "xtream", host: base, user: u.trim(), pass: p.trim() });
      reset();
      done(`Compte ajout\xE9. ${info}`, true);
    } catch (e) {
      done(e.message);
    }
  };
  const submit = async () => {
    if (busy) return;
    if (mode === "xtream") return addXtream(host, user, pass, name);
    if (mode === "m3u") {
      const link = url.trim();
      if (!/^https?:\/\//i.test(link)) return done("Colle un lien commen\xE7ant par http:// ou https://.");
      const x = fromGetPhp(link);
      if (x) return addXtream(x.host, x.user, x.pass, name);
      setBusy(true);
      setMsg("T\xE9l\xE9chargement de la playlist\u2026");
      try {
        const items = parseM3U(await fetchText(link), "x");
        if (!items.length) throw new Error("Aucune cha\xEEne trouv\xE9e dans cette playlist.");
        await onAdd({ id: newId(), name: name.trim() || "Playlist M3U", type: "m3u", url: link });
        reset();
        done(`Playlist ajout\xE9e : ${items.length} entr\xE9es.`, true);
      } catch (e) {
        done(e.message);
      }
    }
  };
  const pickFile = async () => {
    if (busy) return;
    try {
      const r = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true });
      if (r.canceled || !r.assets || !r.assets[0]) return;
      const a = r.assets[0];
      setBusy(true);
      setMsg("Lecture du fichier\u2026");
      const text = await (await fetch(a.uri)).text();
      const items = parseM3U(text, "x");
      if (!items.length) throw new Error("Aucune cha\xEEne trouv\xE9e dans ce fichier. Il doit commencer par #EXTM3U.");
      await onAdd({ id: newId(), name: name.trim() || a.name || "Fichier M3U", type: "file" }, text);
      reset();
      done(`Fichier ajout\xE9 : ${items.length} entr\xE9es.`, true);
    } catch (e) {
      done(e.message || "Impossible de lire ce fichier.");
    }
  };
  const MODES = [
    ["xtream", "Xtream"],
    ["m3u", "Lien M3U"],
    ["file", "Fichier"]
  ];
  return <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : void 0} style={{ flex: 1, backgroundColor: C.bg }}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40, gap: 14 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <T style={{ fontSize: 26, fontWeight: "700" }}>Mes sources</T>
            <Pressable onPress={onClose} style={styles.ib} accessibilityLabel="Fermer">
              <Ionicons name="close" size={24} color="#fff" />
            </Pressable>
          </View>
          <T style={{ color: C.muted, fontSize: 14 }}>
            Primeiptv4k ne fournit aucune chaîne. Ajoute uniquement des playlists et des comptes dont tu as les droits.
          </T>

          {sources.map((s) => {
            const st = status[s.id];
            return <View key={s.id} style={styles.src}>
                <View style={{ flex: 1, gap: 2 }}>
                  <T style={{ fontWeight: "600", fontSize: 16 }} numberOfLines={1}>
                    {s.name}
                  </T>
                  <T style={{ color: C.muted, fontSize: 12 }}>{s.type === "xtream" ? "Compte Xtream" : s.type === "m3u" ? "Lien M3U" : "Fichier M3U"}</T>
                  {st && st.state === "loading" ? <T style={{ color: C.muted, fontSize: 13 }}>Chargement…</T> : null}
                  {st && st.state === "ok" ? <T style={{ color: "#5ad18a", fontSize: 13 }}>{st.msg}</T> : null}
                  {st && st.state === "error" ? <T style={{ color: C.danger, fontSize: 13 }}>{st.msg}</T> : null}
                </View>
                {s.type !== "file" ? <Pressable onPress={() => onRefresh(s)} style={styles.ib2} accessibilityLabel="Actualiser">
                    <Ionicons name="refresh" size={20} color={C.fg} />
                  </Pressable> : null}
                <Pressable onPress={() => onRemove(s.id)} style={styles.ib2} accessibilityLabel="Supprimer">
                  <Ionicons name="trash-outline" size={20} color={C.danger} />
                </Pressable>
              </View>;
          })}

          <T style={{ fontSize: 20, fontWeight: "700", marginTop: 8 }}>Ajouter une source</T>
          <View style={styles.seg}>
            {MODES.map(([k, l]) => <Pressable key={k} onPress={() => {
              setMode(k);
              setMsg("");
            }} style={[styles.segBtn, mode === k && styles.segOn]}>
                <T style={{ fontWeight: "600", color: mode === k ? "#fff" : C.muted }}>{l}</T>
              </Pressable>)}
          </View>
          <Field value={name} onChangeText={setName} placeholder="Nom (facultatif)" />
          {mode === "xtream" ? <>
              <Field value={host} onChangeText={setHost} placeholder="Serveur, ex. http://exemple.com:8080" keyboardType="url" />
              <Field value={user} onChangeText={setUser} placeholder="Identifiant" />
              <Field value={pass} onChangeText={setPass} placeholder="Mot de passe" secureTextEntry />
            </> : null}
          {mode === "m3u" ? <>
              <Field value={url} onChangeText={setUrl} placeholder="Lien de la playlist (http://…)" keyboardType="url" />
              <T style={{ color: C.muted, fontSize: 13 }}>Un lien get.php avec identifiant et mot de passe est reconnu et ajouté comme compte Xtream.</T>
            </> : null}
          {mode === "file" ? <T style={{ color: C.muted, fontSize: 13 }}>Choisis un fichier .m3u ou .m3u8 enregistré sur ton téléphone (Fichiers, iCloud Drive, Téléchargements).</T> : null}
          {msg ? <T style={{ color: ok ? "#5ad18a" : busy ? C.muted : C.danger }}>{msg}</T> : null}
          <Pressable style={[styles.btnPri, { alignSelf: "stretch", opacity: busy ? 0.6 : 1 }]} onPress={mode === "file" ? pickFile : submit} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <T style={styles.btnTxt}>{mode === "file" ? "Choisir un fichier" : "V\xE9rifier et ajouter"}</T>}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>;
}
export default function App() {
  return <SafeAreaProvider>
      <StatusBar barStyle="light-content" />
      <Root />
    </SafeAreaProvider>;
}
function Root() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [sources, setSources] = useState([]);
  const [catalog, setCatalog] = useState({});
  const [status, setStatus] = useState({});
  const [favs, setFavs] = useState([]);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState("home");
  const [cat, setCat] = useState("Tout");
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [limit, setLimit] = useState(60);
  const [showSources, setShowSources] = useState(false);
  const [detail, setDetail] = useState(null);
  const [playing, setPlaying] = useState(null);
  const [nextReq, setNextReq] = useState(null);
  const [prog, setProg] = useState({});
  const [views, setViews] = useState({});
  const progRef = useRef({});
  const seriesCache = useRef({});
  const playingKey = useRef("");
  const loadSource = useCallback(async (s) => {
    setStatus((p) => ({ ...p, [s.id]: { state: "loading" } }));
    try {
      let res;
      if (s.type === "xtream") {
        res = await loadXtream(s);
      } else {
        const text = s.type === "file" ? await AsyncStorage.getItem("p4k-file-" + s.id) || "" : await fetchText(s.url);
        const items2 = parseM3U(text, s.id);
        if (!items2.length) throw new Error("Aucune cha\xEEne trouv\xE9e dans cette playlist.");
        res = { items: items2, info: `${items2.length} entr\xE9es` };
      }
      setCatalog((p) => ({ ...p, [s.id]: res.items }));
      setStatus((p) => ({ ...p, [s.id]: { state: "ok", msg: res.info } }));
    } catch (e) {
      setStatus((p) => ({ ...p, [s.id]: { state: "error", msg: e.message || "Erreur inconnue." } }));
    }
  }, []);
  useEffect(() => {
    (async () => {
      const list = await readSources();
      try {
        const f = await AsyncStorage.getItem("p4k-favs");
        if (f) setFavs(JSON.parse(f));
      } catch {
      }
      try {
        const v = await AsyncStorage.getItem("p4k-views");
        if (v) setViews(JSON.parse(v));
      } catch {
      }
      try {
        const g = await AsyncStorage.getItem("p4k-progress");
        if (g) {
          const m = JSON.parse(g);
          if (m && typeof m === "object") {
            progRef.current = m;
            setProg(m);
          }
        }
      } catch {
      }
      setSources(list);
      setReady(true);
      list.forEach((s) => loadSource(s));
    })();
  }, [loadSource]);
  const addSource = useCallback(
    async (s, fileText) => {
      if (fileText !== void 0) await AsyncStorage.setItem("p4k-file-" + s.id, fileText);
      const list = [...sources, s];
      setSources(list);
      await writeSources(list);
      loadSource(s);
    },
    [sources, loadSource]
  );
  const removeSource = useCallback(
    async (id) => {
      const list = sources.filter((s) => s.id !== id);
      setSources(list);
      setCatalog((p) => {
        const n = { ...p };
        delete n[id];
        return n;
      });
      setStatus((p) => {
        const n = { ...p };
        delete n[id];
        return n;
      });
      await writeSources(list);
      AsyncStorage.removeItem("p4k-file-" + id).catch(() => {
      });
      progRef.current = dropSource(progRef.current, id);
      setProg(progRef.current);
      AsyncStorage.setItem("p4k-progress", JSON.stringify(progRef.current)).catch(() => {
      });
    },
    [sources]
  );
  const loadSeasons = useCallback(
    async (item) => {
      const hit = seriesCache.current[item.id];
      if (hit) return hit;
      const src = sources.find((s) => s.id === item.sid);
      if (!src || src.type !== "xtream" || !item.seriesId) throw new Error("Aucun \xE9pisode disponible pour cette s\xE9rie.");
      const base = src.host;
      const u = src.user;
      const p = src.pass;
      const j = await fetchJson(xtreamApi(base, u, p, "get_series_info", `&series_id=${item.seriesId}`), 6e4);
      const r = parseSeriesInfo(base, u, p, j);
      seriesCache.current[item.id] = r;
      return r;
    },
    [sources]
  );
  const onProgress = useCallback((track, urls, pos, dur, commit, next) => {
    const nx = next && next.track ? { track: next.track, urls: next.urls } : null;
    const upd = updateProg(progRef.current, track, urls, pos, dur, Date.now(), nx);
    if (upd === progRef.current) return;
    progRef.current = upd;
    AsyncStorage.setItem("p4k-progress", JSON.stringify(upd)).catch(() => {
    });
    if (commit) setProg(upd);
  }, []);
  const saveProg = useCallback((upd) => {
    progRef.current = upd;
    setProg(upd);
    AsyncStorage.setItem("p4k-progress", JSON.stringify(upd)).catch(() => {
    });
  }, []);
  const openVlc = useCallback(
    (req) => {
      const u = req.urls.find((x) => /\.mkv(\?|$)/i.test(x)) || req.urls[0];
      if (req.track) saveProg(markLaunched(progRef.current, req.track, req.urls, Date.now()));
      setPlaying(null);
      setNextReq(null);
      Linking.openURL("vlc-x-callback://x-callback-url/stream?url=" + encodeURIComponent(u)).catch(
        () => Linking.openURL("https://apps.apple.com/app/vlc-for-mobile/id650377962").catch(() => {
        })
      );
    },
    [saveProg]
  );
  const onMark = useCallback(
    (track, urls, next, on) => {
      saveProg(on ? markWatched(progRef.current, track, urls, Date.now(), next) : unmarkWatched(progRef.current, track.key));
    },
    [saveProg]
  );
  const removeContinue = useCallback((itemId) => {
    progRef.current = removeFromContinue(progRef.current, itemId);
    setProg(progRef.current);
    AsyncStorage.setItem("p4k-progress", JSON.stringify(progRef.current)).catch(() => {
    });
  }, []);
  const toggleFav = useCallback((id) => {
    setFavs((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      AsyncStorage.setItem("p4k-favs", JSON.stringify(next)).catch(() => {
      });
      return next;
    });
  }, []);
  const items = useMemo(() => {
    const out = [];
    Object.keys(catalog).forEach((k) => {
      const list = catalog[k];
      for (let i = 0; i < list.length; i++) out.push(list[i]);
    });
    return out;
  }, [catalog]);
  const favSet = useMemo(() => new Set(favs), [favs]);
  const byKind = useMemo(
    () => ({
      tv: items.filter((i) => i.kind === "tv"),
      film: items.filter((i) => i.kind === "film"),
      serie: items.filter((i) => i.kind === "serie")
    }),
    [items]
  );
  const topChannels = useMemo(() => topViewed(byKind.tv, views, 10), [byKind, views]);
  const topFilms = useMemo(() => {
    const t = topRated(byKind.film, 10);
    return t.length ? { rated: true, list: t } : { rated: false, list: byKind.film.slice(0, 10) };
  }, [byKind]);
  const topSeries = useMemo(() => {
    const t = topRated(byKind.serie, 10);
    return t.length ? { rated: true, list: t } : { rated: false, list: byKind.serie.slice(0, 10) };
  }, [byKind]);
  const favItems = useMemo(() => items.filter((i) => favSet.has(i.id)), [items, favSet]);
  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    let count = 0;
    const matches = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.title.toLowerCase().includes(s) || item.cat.toLowerCase().includes(s)) {
        matches.push(item);
        count++;
        if (count >= 150) break;
      }
    }
    return matches;
  }, [items, q]);
  const sectionData = tab === "list" ? favItems : tab === "home" ? [] : byKind[tab];
  const cats = useMemo(() => ["Tout", ...Array.from(new Set(sectionData.map((i) => i.cat)))], [sectionData]);
  const filtered = useMemo(() => cat === "Tout" ? sectionData : sectionData.filter((i) => i.cat === cat), [sectionData, cat]);
  const byId = useMemo(() => {
    const m = {};
    for (let i = 0; i < items.length; i++) m[items[i].id] = items[i];
    return m;
  }, [items]);
  const continueEntries = useMemo(
    () => continueList(prog, 20).map((rec) => ({ rec, item: byId[rec.itemId] })).filter((e) => !!e.item),
    [prog, byId]
  );
  const play = useCallback(
    (r0) => {
      const req = { ...r0, urls: orderForPlatform(r0.urls, Platform.OS === "ios") };
      const key = req.urls[0];
      playingKey.current = key;
      setNextReq(null);
      setPlaying(req);
      const t = req.track;
      if (t && t.kind === "serie" && t.epId) {
        const it = byId[t.itemId];
        if (it) {
          loadSeasons(it).then((r) => {
            const n = nextEpisode(r.seasons, t.epId);
            if (n && playingKey.current === key) setNextReq(epReq(it, n, progRef.current));
          }).catch(() => {
          });
        }
      }
    },
    [byId, loadSeasons]
  );
  const open = useCallback(
    (i) => {
      if (i.kind === "tv" && i.urls) {
        setViews((prev) => {
          const n = bumpView(prev, i.id);
          AsyncStorage.setItem("p4k-views", JSON.stringify(n)).catch(() => {
          });
          return n;
        });
        play({ title: i.title, urls: i.urls });
      }
      else setDetail(i);
    },
    [play]
  );
  const goTab = (t) => {
    setTab(t);
    setCat("Tout");
    setLimit(60);
    setSearching(false);
    setQ("");
  };
  const loadingNow = Object.values(status).some((s) => s.state === "loading");
  const errorCount = Object.values(status).filter((s) => s.state === "error").length;
  const hero = useMemo(() => {
    const pool = [...byKind.film, ...byKind.serie];
    const withImg = pool.filter((i) => i.icon && i.rating).slice(0, 3);
    return withImg.length ? withImg : pool.slice(0, 3);
  }, [byKind]);
  const topBar = <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
      <Pressable style={styles.ib} onPress={() => goTab("list")} accessibilityLabel="Ma liste">
        <Ionicons name="bookmark-outline" size={22} color={C.fg} />
      </Pressable>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <T style={styles.brand}>
          Prime<Text style={{ color: C.accent }}>iptv</Text>
        </T>
        <View style={styles.k4}>
          <Text style={{ color: C.accent, fontSize: 9, fontWeight: "700", letterSpacing: 0.8 }}>4K</Text>
        </View>
      </View>
      <Pressable style={styles.ib} onPress={() => setShowSources(true)} accessibilityLabel="Mes sources">
        <Ionicons name="add" size={26} color={C.fg} />
      </Pressable>
    </View>;
  const banner = loadingNow || errorCount ? <Pressable onPress={() => setShowSources(true)} style={styles.banner}>
        {loadingNow ? <ActivityIndicator size="small" color={C.fg} /> : <Ionicons name="alert-circle" size={18} color={C.danger} />}
        <T style={{ fontSize: 13 }}>
          {loadingNow ? "Chargement des sources\u2026" : `${errorCount} source${errorCount > 1 ? "s" : ""} en erreur. Touche pour voir.`}
        </T>
      </Pressable> : null;
  const searchBox = searching ? <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>
      <TextInput
        autoFocus
        value={q}
        onChangeText={(t) => {
          setQ(t);
          setLimit(60);
        }}
        placeholder="Chaîne, film ou série"
        placeholderTextColor={C.muted}
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="while-editing"
        style={styles.input}
      />
    </View> : null;
  const title = (t) => <T style={styles.ptitle}>{t}</T>;
  const empty = <View style={styles.empty}>
      <Ionicons name="tv-outline" size={48} color={C.muted} />
      <T style={{ fontSize: 20, fontWeight: "700", textAlign: "center" }}>{ready ? "Aucune source pour le moment" : "Chargement\u2026"}</T>
      {ready ? <>
          <T style={{ color: C.muted, textAlign: "center" }}>
            Ajoute un compte Xtream, un lien M3U ou un fichier M3U pour afficher tes chaînes, films et séries.
          </T>
          <Pressable style={styles.btnPri} onPress={() => setShowSources(true)}>
            <T style={styles.btnTxt}>Ajouter une source</T>
          </Pressable>
        </> : null}
    </View>;
  const gridPad = 16;
  const gap = 12;
  const renderGrid = (data, cols, header, total) => {
    const w = (width - gridPad * 2 - gap * (cols - 1)) / cols;
    return <FlashList
      key={`g${cols}`}
      data={data.slice(0, limit)}
      numColumns={cols}
      keyExtractor={(i) => i.id}
      ListHeaderComponent={header}
      ListEmptyComponent={<T style={{ color: C.muted, textAlign: "center", marginTop: 40 }}>Rien à afficher ici.</T>}
      contentContainerStyle={{ paddingBottom: insets.bottom + 130, paddingHorizontal: gridPad }}
      onEndReachedThreshold={0.6}
      onEndReached={() => total > limit && limit < 1200 && setLimit((l) => l + 60)}
      keyboardShouldPersistTaps="handled"
      renderItem={({ item, index }) => (
        <View style={{ marginBottom: 18, marginLeft: index % cols === 0 ? 0 : gap / 2, marginRight: index % cols === cols - 1 ? 0 : gap / 2 }}>
          <Card item={item} w={(width - gridPad * 2 - gap * (cols - 1)) / cols} onOpen={open} />
        </View>
      )}
    />;
  };
  let body;
  if (searching && q.trim()) {
    body = renderGrid(
      results,
      3,
      <View>
        {topBar}
        {banner}
        {searchBox}
        <T style={styles.count}>{results.length} résultat{results.length > 1 ? "s" : ""}</T>
      </View>,
      results.length
    );
  } else if (tab === "home") {
    body = <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 130 }} keyboardShouldPersistTaps="handled">
        {topBar}
        {banner}
        {searchBox}
        {items.length === 0 ? empty : <>
            {title(TITLES.home)}
            {hero.length ? <Hero items={hero} width={width} onOpen={open} /> : null}
            <ContinueRail entries={continueEntries} onPlay={(r) => play(recReq(r))} onRemove={removeContinue} />
            <Rail title="Tes chaînes les plus regardées" data={topChannels} onOpen={open} />
            <Rail title={topFilms.rated ? "Films les mieux notés" : "Films à découvrir"} data={topFilms.list} onOpen={open} />
            <Rail title={topSeries.rated ? "Séries les mieux notées" : "Séries à découvrir"} data={topSeries.list} onOpen={open} />
            <Rail title="Ma liste" data={favItems.slice(0, 20)} onOpen={open} />
          </>}
      </ScrollView>;
  } else {
    const cols = tab === "tv" ? 2 : tab === "list" ? 3 : 3;
    const header = <View>
        {topBar}
        {banner}
        {searchBox}
        {title(TITLES[tab])}
        {sectionData.length ? <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingBottom: 14 }}>
              {cats.slice(0, 120).map((c) => <Pressable key={c} onPress={() => {
                setCat(c);
                setLimit(60);
              }} style={[styles.chip, cat === c && styles.chipOn]}>
                  <T style={{ fontWeight: cat === c ? "700" : "500", color: cat === c ? "#fff" : C.muted }}>{c}</T>
                </Pressable>)}
            </ScrollView>
            <T style={styles.count}>{filtered.length} élément{filtered.length > 1 ? "s" : ""}</T>
          </> : null}
      </View>;
    body = renderGrid(filtered, cols, header, filtered.length);
  }
  const detailSrc = detail ? sources.find((s) => s.id === detail.sid) : void 0;
  const similar = useMemo(() => {
    if (!detail) return [];
    const out = [];
    for (let i = 0; i < items.length && out.length < 18; i++) {
      const x = items[i];
      if (x.id !== detail.id && x.kind === detail.kind && x.cat === detail.cat) out.push(x);
    }
    return out;
  }, [detail, items]);
  return <View style={{ flex: 1, backgroundColor: C.bg }}>
      {body}
      <Dock
        tab={searching ? null : tab === "list" ? null : tab}
        onTab={goTab}
        onSearch={() => {
          setSearching((v) => !v);
          setQ("");
        }}
      />
      {showSources ? <SourcesModal sources={sources} status={status} onAdd={addSource} onRemove={removeSource} onRefresh={loadSource} onClose={() => setShowSources(false)} /> : null}
      {detail ? <DetailModal
        key={detail.id}
        item={detail}
        source={detailSrc}
        fav={favSet.has(detail.id)}
        prog={prog}
        similar={similar}
        loadSeasons={loadSeasons}
        onFav={() => toggleFav(detail.id)}
        onPlay={play}
        onOpen={setDetail}
        onMark={onMark}
        onClose={() => setDetail(null)}
      /> : null}
      {playing ? <PlayerModal
        key={playing.urls[0]}
        req={playing}
        next={nextReq}
        onProgress={onProgress}
        onVlc={openVlc}
        onNext={() => {
          if (nextReq) play(nextReq);
        }}
        onClose={() => {
          setPlaying(null);
          setNextReq(null);
        }}
      /> : null}
    </View>;
}
const styles = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 4 },
  ib: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: C.glass, borderWidth: 1, borderColor: C.line },
  ib2: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: C.surface2 },
  brand: { fontSize: 20, fontWeight: "800", letterSpacing: -0.4 },
  k4: { borderWidth: 1.5, borderColor: C.accent, borderRadius: 4, paddingHorizontal: 4, paddingVertical: 2 },
  ptitle: { fontSize: 32, fontWeight: "700", letterSpacing: -0.6, paddingHorizontal: 16, marginTop: 12, marginBottom: 16 },
  count: { color: C.muted, fontSize: 14, paddingHorizontal: 16, marginBottom: 14 },
  h2: { fontSize: 26, fontWeight: "700", letterSpacing: -0.5 },
  underline: { width: 72, height: 4, borderRadius: 2, marginTop: 10 },
  banner: { flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "center", backgroundColor: C.surface, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, marginTop: 8 },
  empty: { alignItems: "center", gap: 14, paddingHorizontal: 32, marginTop: 90 },
  poster: { aspectRatio: 2 / 3, borderRadius: 18, overflow: "hidden", justifyContent: "flex-end", padding: 11, backgroundColor: C.surface },
  posterTitle: { fontSize: 15, fontWeight: "800", textTransform: "uppercase", letterSpacing: -0.2 },
  badge: { position: "absolute", top: 0, left: 0, backgroundColor: C.accent, paddingHorizontal: 10, paddingVertical: 6, borderTopLeftRadius: 18, borderBottomRightRadius: 14 },
  badgeTxt: { fontSize: 12, fontWeight: "700" },
  cap: { marginTop: 8, fontSize: 14, fontWeight: "600" },
  capSub: { color: C.muted, fontSize: 13 },
  ch: { backgroundColor: C.surface, borderRadius: 28, paddingTop: 50, paddingBottom: 16, paddingHorizontal: 14, alignItems: "center", gap: 5 },
  live: { position: "absolute", top: 0, left: 0, backgroundColor: C.accent, paddingHorizontal: 14, paddingVertical: 7, borderTopLeftRadius: 28, borderBottomRightRadius: 20 },
  liveTxt: { fontSize: 13, fontWeight: "700", letterSpacing: 0.6 },
  logo: { width: 76, height: 76, borderRadius: 7, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", overflow: "hidden", marginBottom: 6, paddingHorizontal: 4 },
  logoTxt: { fontSize: 16, fontWeight: "800" },
  chName: { fontSize: 16, fontWeight: "700", maxWidth: "100%" },
  chSub: { color: C.muted, fontSize: 14, maxWidth: "100%" },
  kind: { position: "absolute", top: 16, alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 8, height: 44, paddingHorizontal: 18, borderRadius: 22, backgroundColor: "rgba(60,50,40,0.55)", borderWidth: 1, borderColor: "rgba(255,255,255,0.22)" },
  kindTxt: { fontSize: 18, fontWeight: "600" },
  rank: { position: "absolute", left: 14, bottom: -30, fontSize: 170, fontWeight: "700", color: "rgba(255,255,255,0.16)", letterSpacing: -10 },
  art: { position: "absolute", left: 24, right: 24, bottom: 46, alignItems: "center", gap: 4 },
  artTitle: { fontSize: 40, fontWeight: "900", textAlign: "center", letterSpacing: -1, transform: [{ skewX: "-6deg" }] },
  artSub: { color: C.gold, fontSize: 14, fontWeight: "700", letterSpacing: 2 },
  hbar: { position: "absolute", bottom: 16, alignSelf: "center", width: 130, height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.28)" },
  dock: { position: "absolute", left: 16, right: 16, flexDirection: "row", gap: 10, alignItems: "center" },
  pill: { flex: 1, flexDirection: "row", padding: 6, borderRadius: 40, overflow: "hidden", backgroundColor: "rgba(28,28,30,0.96)", borderWidth: 1, borderColor: C.line },
  tabBtn: { flex: 1, height: 58, borderRadius: 30, alignItems: "center", justifyContent: "center", gap: 3, paddingHorizontal: 2 },
  tabOn: { backgroundColor: "rgba(61,139,255,0.18)", borderWidth: 1, borderColor: "rgba(61,139,255,0.4)" },
  srch: { width: 72, height: 72, borderRadius: 36, overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: "rgba(28,28,30,0.96)", borderWidth: 1, borderColor: C.line },
  chip: { height: 38, paddingHorizontal: 16, borderRadius: 19, backgroundColor: C.surface, alignItems: "center", justifyContent: "center" },
  chipOn: { backgroundColor: C.accent },
  btnPri: { height: 48, paddingHorizontal: 22, borderRadius: 14, backgroundColor: C.accent, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  btnSec: { height: 48, paddingHorizontal: 22, borderRadius: 14, backgroundColor: C.surface2, alignItems: "center", justifyContent: "center" },
  btnTxt: { fontWeight: "600", fontSize: 16 },
  input: { height: 48, borderRadius: 14, backgroundColor: C.surface, color: C.fg, paddingHorizontal: 14, fontSize: 16, borderWidth: 1, borderColor: C.line },
  pTop: { position: "absolute", top: 0, left: 0, right: 0, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14 },
  pTitle: { flex: 1, textAlign: "center", fontWeight: "600", fontSize: 16, marginHorizontal: 10 },
  center: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", padding: 24 },
  errBox: { backgroundColor: "rgba(28,28,30,0.96)", borderRadius: 20, padding: 20, gap: 12, alignItems: "center", maxWidth: 340 },
  dTitle: { fontSize: 34, fontWeight: "800", letterSpacing: -0.8, lineHeight: 38 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12 },
  metaTxt: { color: C.muted, fontSize: 14 },
  btnWhite: { height: 50, borderRadius: 10, backgroundColor: "#fff", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  btnWhiteTxt: { color: "#000", fontSize: 17, fontWeight: "700" },
  btnGrey: { height: 46, borderRadius: 10, backgroundColor: C.surface2, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  actRow: { flexDirection: "row", gap: 28, paddingVertical: 4 },
  act: { alignItems: "center", gap: 4, minWidth: 56 },
  actTxt: { fontSize: 12, color: C.muted },
  dtabs: { flexDirection: "row", gap: 22, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line, marginTop: 6 },
  dtab: { paddingTop: 12, paddingBottom: 6, borderTopWidth: 3, borderTopColor: "transparent", marginTop: -2 },
  dtabOn: { borderTopColor: C.accent },
  epRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  epThumb: { width: 140, aspectRatio: 16 / 9, borderRadius: 8, overflow: "hidden", backgroundColor: C.surface, alignItems: "center", justifyContent: "center" },
  epPlay: { width: 34, height: 34, borderRadius: 17, backgroundColor: "rgba(0,0,0,0.5)", borderWidth: 1.5, borderColor: "rgba(255,255,255,0.85)", alignItems: "center", justifyContent: "center" },
  epNum: { position: "absolute", left: 8, bottom: 2, color: "rgba(255,255,255,0.9)", fontSize: 26, fontWeight: "800" },
  pbar: { height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.22)", overflow: "hidden" },
  pfill: { height: 4, borderRadius: 2, backgroundColor: C.accent },
  nextBtn: { position: "absolute", right: 16, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#fff", borderRadius: 8, paddingHorizontal: 16, height: 44 },
  cwBox: { width: 232, aspectRatio: 16 / 9, borderRadius: 16, overflow: "hidden", backgroundColor: C.surface, justifyContent: "flex-end", padding: 12 },
  cwTitle: { fontSize: 17, fontWeight: "800", textTransform: "uppercase", letterSpacing: -0.2, marginBottom: 6 },
  cwPlay: { position: "absolute", alignSelf: "center", top: "50%", marginTop: -22, width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(0,0,0,0.5)", borderWidth: 1.5, borderColor: "rgba(255,255,255,0.8)", alignItems: "center", justifyContent: "center" },
  cwX: { position: "absolute", top: 8, right: 8, width: 28, height: 28, borderRadius: 14, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center" },
  cwBar: { position: "absolute", left: 0, right: 0, bottom: 0, height: 4, backgroundColor: "rgba(255,255,255,0.25)" },
  dHero: { height: 300, justifyContent: "flex-end", marginBottom: 14 },
  ep: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line },
  src: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: C.surface, borderRadius: 18, padding: 14 },
  seg: { flexDirection: "row", backgroundColor: C.surface, borderRadius: 14, padding: 4 },
  segBtn: { flex: 1, height: 40, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  segOn: { backgroundColor: C.accent }
});