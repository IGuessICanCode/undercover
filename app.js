/* Undercover — Mood Labs. Pass-the-phone party game. */
(function () {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  const CATCH_POINTS = 10;     // to every innocent when the imposter is caught and guesses wrong
  const IMPOSTER_POINTS = 20;  // to an imposter who guesses the word or survives
  const MIN_PLAYERS = 3, MAX_PLAYERS = 12;

  const TROPHY_LINES = ["Trust issues: unlocked", "Professional liar", "Never trust this one", "Will never shut up about this win"];
  const TOMB_INNOCENT = ["Here lies {name}. Innocent.", "Here lies {name}. Wrongly accused.", "RIP {name}. Was telling the truth."];
  const TOMB_IMPOSTER = ["Here lies {name}. Bad guesser.", "RIP {name}. So close."];
  const HELLO_LINES = ["Told you I was innocent", "Trust me, bro", "I'm totally innocent"];
  const BIN_STOLEN = ["This group's ability to be subtle", "Your 'subtle' clues", "Everyone's poker face"];
  const BIN_SURVIVED = ["This group's detective skills", "Your gut instincts", "This group's ability to spot a liar"];

  const state = {
    total: 6, imposters: 1, totalRounds: 5,
    players: [],        // { name, score } in the order they joined
    roundNo: 0,
    deck: [],           // words not used yet this game
    word: "",
    cards: [],          // "imp" | "inn" per face-down card
    taken: {},          // card index -> player index
    role: [],           // per player: "imp" | "inn"
    alive: [],          // per player
    turn: 0,            // whose turn to pick
    selectedCard: null,
    clueRound: 0,
    voteSel: null,
    caught: null,       // imposter now guessing
    sound: true,
    more: 2,
    last: {},
  };

  /* ---------- Fit 390×844 to any screen ---------- */
  function fit() {
    const s = Math.min(window.innerWidth / 390, window.innerHeight / 844);
    document.documentElement.style.setProperty("--scale", s);
  }
  window.addEventListener("resize", fit);
  fit();

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  };

  /* ---------- Helpers ---------- */
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  function pick(list, key) {
    let k; do { k = Math.floor(Math.random() * list.length); } while (list.length > 1 && k === state.last[key]);
    state.last[key] = k;
    return list[k];
  }
  function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }
  function joinNames(names) { return names.length < 2 ? names.join("") : names.slice(0, -1).join(", ") + " & " + names[names.length - 1]; }
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9ऀ-ॿ]/g, "");

  const sounds = {};
  ["success", "start", "unsuccessful"].forEach((n) => { try { sounds[n] = new Audio("assets/" + n + ".mp3"); } catch (e) {} });
  function play(n) {
    if (!state.sound || !sounds[n]) return;
    try { sounds[n].currentTime = 0; const p = sounds[n].play(); if (p && p.catch) p.catch(() => {}); } catch (e) {}
  }

  function show(id) {
    $$(".screen").forEach((s) => s.classList.toggle("active", s.id === "s-" + id));
    $("#stage").scrollTop = 0;
  }

  function fitText(el, max, min, width) {
    let size = max;
    el.style.fontSize = size + "px";
    while (size > min && el.scrollWidth > width) { size -= 2; el.style.fontSize = size + "px"; }
  }

  const aliveIdx = (role) => state.players.map((_, i) => i).filter((i) => state.alive[i] && (!role || state.role[i] === role));
  const roundLabel = () => $$("[data-round-label]").forEach((e) => (e.textContent = "ROUND " + state.roundNo + " OF " + state.totalRounds));

  /* ---------- Setup ---------- */
  function maxImposters(n) { return Math.max(1, Math.floor((n - 1) / 2)); }
  function renderSetup() {
    $("#playerNum").textContent = state.total;
    $("#minus").disabled = state.total <= MIN_PLAYERS;
    $("#plus").disabled = state.total >= MAX_PLAYERS;
    const max = maxImposters(state.total);
    if (state.imposters > max) state.imposters = max;
    $$("[data-imp]").forEach((b) => {
      const n = Number(b.dataset.imp);
      b.disabled = n > max;
      b.classList.toggle("selected", n === state.imposters);
    });
    $$("[data-rounds]").forEach((b) => b.classList.toggle("selected", Number(b.dataset.rounds) === state.totalRounds));
  }
  $("#minus").addEventListener("click", () => { state.total = Math.max(MIN_PLAYERS, state.total - 1); renderSetup(); });
  $("#plus").addEventListener("click", () => { state.total = Math.min(MAX_PLAYERS, state.total + 1); renderSetup(); });
  $$("[data-imp]").forEach((b) => b.addEventListener("click", () => { state.imposters = Number(b.dataset.imp); renderSetup(); }));
  $$("[data-rounds]").forEach((b) => b.addEventListener("click", () => { state.totalRounds = Number(b.dataset.rounds); renderSetup(); }));
  $("#goSetup").addEventListener("click", () => { renderSetup(); show("setup"); });
  $("#deal").addEventListener("click", () => {
    state.players = [];
    state.roundNo = 0;
    state.chosenRounds = state.totalRounds;
    state.deck = shuffle((window.WORDS || []).slice());
    play("start");
    startRound();
  });

  /* ---------- Round: deal & pick ---------- */
  function nextWord() {
    if (!state.deck.length) state.deck = shuffle((window.WORDS || []).filter((w) => w !== state.word));
    return state.deck.pop();
  }

  function startRound() {
    state.roundNo += 1;
    state.word = nextWord();
    const n = state.roundNo === 1 ? state.total : state.players.length;
    state.cards = shuffle(Array.from({ length: n }, (_, i) => (i < state.imposters ? "imp" : "inn")));
    state.taken = {};
    state.role = [];
    state.alive = Array(n).fill(true);
    state.turn = 0;
    state.clueRound = 0;
    renderPick();
    show("pick");
  }

  const isFirstRound = () => state.roundNo === 1;
  const totalThisRound = () => state.cards.length;

  function renderPick() {
    state.selectedCard = null;
    const i = state.turn;
    $("#pickKicker").textContent = "PLAYER " + (i + 1) + " OF " + totalThisRound();
    if (isFirstRound()) {
      $("#pickTitle").innerHTML = i === 0 ? "You're first.<br>Who's this?" : "Pass the phone.<br>Who's this?";
      $("#nameForm").hidden = false;
      $("#nameInput").value = "";
    } else {
      $("#pickTitle").innerHTML = "Pass the phone to<br>" + esc(state.players[i].name);
      $("#nameForm").hidden = true;
    }
    $("#nameErr").hidden = true;
    renderCards();
  }

  function renderCards() {
    const wrap = $("#cards");
    wrap.innerHTML = "";
    wrap.classList.toggle("many", state.cards.length > 9);
    let left = 0;
    state.cards.forEach((_, c) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "pick-card";
      if (c in state.taken) {
        b.classList.add("taken");
        b.disabled = true;
        b.innerHTML = "<small>TAKEN</small><b></b>";
        b.querySelector("b").textContent = state.players[state.taken[c]].name;
      } else {
        left += 1;
        b.textContent = "?";
        b.setAttribute("aria-label", "Card " + (c + 1));
        if (state.selectedCard === c) b.classList.add("selected");
        b.addEventListener("click", () => { state.selectedCard = c; renderCards(); });
      }
      wrap.appendChild(b);
    });
    $("#cardsLeft").textContent = left + " left";
    updateFlip();
  }

  function updateFlip() {
    const nameOk = !isFirstRound() || $("#nameInput").value.trim().length > 0;
    $("#flip").disabled = state.selectedCard === null || !nameOk;
  }
  $("#nameInput").addEventListener("input", () => { $("#nameErr").hidden = true; updateFlip(); });
  $("#nameForm").addEventListener("submit", (e) => { e.preventDefault(); $("#nameInput").blur(); if (!$("#flip").disabled) flipCard(); });
  $("#flip").addEventListener("click", flipCard);

  function flipCard() {
    if (state.selectedCard === null) return;
    const i = state.turn;
    if (isFirstRound()) {
      const name = $("#nameInput").value.trim().replace(/\s+/g, " ");
      if (!name) return;
      if (state.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
        $("#nameErr").textContent = name + " is already playing. Add a surname or nickname.";
        $("#nameErr").hidden = false;
        return;
      }
      state.players.push({ name, score: 0 });
    }
    state.taken[state.selectedCard] = i;
    state.role[i] = state.cards[state.selectedCard];
    showCard(i);
  }

  function showCard(i) {
    const p = state.players[i];
    const imp = state.role[i] === "imp";
    const card = $("#secret");
    card.classList.toggle("imposter", imp);
    card.style.animation = "none"; void card.offsetWidth; card.style.animation = "";
    $("#onlyLooks").textContent = "Only " + p.name + " looks";
    $("#secretKicker").textContent = imp ? "NO WORD FOR YOU" : "YOUR SECRET WORD";
    $("#secretWord").hidden = imp;
    $("#secretBlank").hidden = !imp;
    if (imp) {
      $("#secretNote").innerHTML = "You're the imposter.<br>Blend in!";
    } else {
      $("#secretWord").textContent = state.word;
      fitText($("#secretWord"), 64, 30, 290);
      $("#secretNote").textContent = "You're innocent. Find the imposter!";
    }
    const last = i === totalThisRound() - 1;
    $("#passHint").textContent = last
      ? (imp ? "Keep a straight face, then put the phone in the middle" : "Remember it, then put the phone in the middle")
      : (imp ? "Keep a straight face, then pass the phone on" : "Remember it, then pass the phone on");
    $("#hidePass").textContent = last ? "Hide & start" : "Hide & pass";
    show("card");
  }

  $("#hidePass").addEventListener("click", () => {
    if (state.turn < totalThisRound() - 1) {
      state.turn += 1;
      renderPick();
      show("pick");
    } else {
      startClues();
    }
  });

  /* ---------- Clues ---------- */
  function startClues() {
    state.clueRound += 1;
    const inn = aliveIdx("inn");
    const starter = inn[Math.floor(Math.random() * inn.length)];
    roundLabel();
    $("#clueKicker").textContent = state.clueRound === 1 ? "CLUE TIME" : "CLUE ROUND " + state.clueRound;
    const st = $("#starter");
    st.textContent = state.players[starter].name;
    fitText(st, 52, 28, 330);
    // circle order, starting from the starter
    const alive = aliveIdx();
    const from = alive.indexOf(starter);
    const order = alive.slice(from).concat(alive.slice(0, from));
    $("#stillLabel").textContent = "STILL IN · " + alive.length;
    $("#stillChips").innerHTML = order.map((i, k) => '<span class="' + (k === 0 ? "first" : "") + '">' + esc(state.players[i].name) + "</span>").join("");
    show("start");
  }
  $("#toVote").addEventListener("click", () => { state.voteSel = null; renderVote(); show("vote"); });
  $("#backToClues").addEventListener("click", () => show("start"));

  /* ---------- Vote ---------- */
  function renderVote() {
    const wrap = $("#voteTiles");
    wrap.innerHTML = "";
    wrap.classList.toggle("many", state.players.length > 8);
    state.players.forEach((p, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "vote-tile";
      b.innerHTML = '<span></span><svg viewBox="0 0 22 22"><path d="M4 11.5l4.5 4.5L18 6"/></svg>';
      b.querySelector("span").textContent = p.name;
      if (!state.alive[i]) { b.classList.add("out"); b.disabled = true; }
      else {
        if (state.voteSel === i) b.classList.add("selected");
        b.addEventListener("click", () => { state.voteSel = i; renderVote(); });
      }
      wrap.appendChild(b);
    });
    $("#crossedHint").hidden = state.alive.every(Boolean);
    const btn = $("#voteOut");
    btn.disabled = state.voteSel === null;
    btn.textContent = state.voteSel === null ? "Pick someone" : "Vote out " + state.players[state.voteSel].name;
  }

  $("#voteOut").addEventListener("click", () => {
    const i = state.voteSel;
    if (i === null) return;
    state.alive[i] = false;
    if (state.role[i] === "imp") {
      state.caught = i;
      const name = state.players[i].name;
      $("#caughtSub").textContent = name + " was " + (state.imposters > 1 ? "an" : "the") + " imposter";
      $("#guessQ").textContent = name + ", one last chance. What was the secret word?";
      $("#guessInput").value = "";
      $("#lockIn").disabled = true;
      play("success");
      show("caught");
    } else {
      innocentOut(i);
    }
  });

  function impLabel(n) { return n + " imposter" + (n === 1 ? "" : "s"); }

  function innocentOut(i) {
    const imps = aliveIdx("imp");
    // Imposters win if one imposter is among the last 2 players
    if (imps.length >= 1 && aliveIdx().length <= 2) {
      impostersSurvive();
      return;
    }
    play("unsuccessful");
    startClues();
  }

  $("#outNext").addEventListener("click", () => {
    if ($("#outNext").dataset.action === "survived") impostersSurvive();
    else startClues();
  });

  /* ---------- Imposter's guess ---------- */
  $("#guessInput").addEventListener("input", () => { $("#lockIn").disabled = !$("#guessInput").value.trim(); });
  $("#guessForm").addEventListener("submit", (e) => { e.preventDefault(); if (!$("#lockIn").disabled) lockIn(); });
  $("#lockIn").addEventListener("click", lockIn);

  function lockIn() {
    const i = state.caught;
    const guess = $("#guessInput").value.trim();
    if (!guess) return;
    $("#guessInput").blur();
    const p = state.players[i];
    if (norm(guess) === norm(state.word)) {
      p.score += IMPOSTER_POINTS;
      showResult({
        theme: "pink",
        kicker: p.name.toUpperCase() + ' GUESSED "' + state.word.toUpperCase() + '"',
        big: "GOOD ONE!",
        sub: "The imposter got it",
        points: "+" + IMPOSTER_POINTS, pointsTo: "to " + p.name,
        bin: BIN_STOLEN,
      });
      play("success");
      return;
    }
    const imps = aliveIdx("imp");
    if (imps.length > 0) {
      // Imposters win if one is among the last 2 players
      if (aliveIdx().length <= 2) {
        impostersSurvive();
        return;
      }
      // more imposters still hiding: keep the word secret and play on
      $("#outHello").hidden = true;
      $("#outTomb").hidden = false;
      $("#tombText").textContent = pick(TOMB_IMPOSTER, "tombImp").replace("{name}", p.name);
      $("#outBig").textContent = "GOT ONE!";
      $("#outSub").innerHTML = esc(p.name) + " guessed wrong.<br>" + impLabel(imps.length) + " still in.";
      $("#outPill").textContent = aliveIdx().length + " players left · " + impLabel(imps.length);
      $("#outNext").textContent = "Another clue round";
      $("#outNext").dataset.action = "clues";
      play("unsuccessful");
      show("out");
      return;
    }
    // every imposter caught: the group wins
    state.players.forEach((q, k) => { if (state.role[k] === "inn") q.score += CATCH_POINTS; });
    showResult({
      theme: "dark",
      kicker: p.name.toUpperCase() + ' GUESSED "' + guess.toUpperCase() + '"',
      big: "NICE<br>TRY!",
      sub: "The word was",
      points: "+" + CATCH_POINTS, pointsTo: "to everyone else",
    });
    play("success");
    confetti();
  }

  function impostersSurvive() {
    const imps = aliveIdx("imp");
    imps.forEach((k) => (state.players[k].score += IMPOSTER_POINTS));
    const names = imps.map((k) => state.players[k].name);
    showResult({
      theme: "pink",
      kicker: imps.length > 1 ? "THE IMPOSTERS SURVIVED" : "THE IMPOSTER SURVIVED",
      big: "SNEAKY!",
      sub: esc(joinNames(names)) + (imps.length > 1 ? " were the imposters." : " was the imposter.") + "<br>The word was",
      points: "+" + IMPOSTER_POINTS, pointsTo: (imps.length > 1 ? "each to " : "to ") + joinNames(names),
      bin: BIN_SURVIVED,
    });
    play("success");
  }

  /* ---------- Round result ---------- */
  function scoreLine() {
    const sorted = state.players.slice().sort((a, b) => b.score - a.score);
    const parts = sorted.map((p) => esc(p.name) + " " + p.score);
    const lines = [];
    for (let k = 0; k < parts.length; k += 3) lines.push(parts.slice(k, k + 3).join(" · "));
    return lines.join("<br>");
  }

  function showResult(r) {
    const s = $("#s-result");
    s.classList.toggle("dark", r.theme === "dark");
    s.classList.toggle("pink", r.theme === "pink");
    $("#resKicker").textContent = r.kicker;
    $("#resBig").innerHTML = r.big;
    $("#resSub").innerHTML = r.sub;
    $("#resWord").textContent = state.word;
    $("#resPoints").innerHTML = "<b></b><span></span>";
    $("#resPoints b").textContent = r.points;
    $("#resPoints span").textContent = r.pointsTo;
    $("#resScores").innerHTML = scoreLine();
    $("#resBin").hidden = !r.bin || state.players.length > 9;
    if (r.bin) $("#resBinText").textContent = pick(r.bin, "bin");
    $("#nextRound").textContent = state.roundNo >= state.totalRounds ? "See final scores" : "Next round";
    show("result");
    fitBin();
  }

  // keep the bin sticker clear of the button: shrink it, or drop it if there's still no room
  function fitBin() {
    const bin = $("#resBin");
    if (bin.hidden) return;
    bin.classList.remove("small");
    const room = () => $("#s-result .actions").offsetTop - (bin.offsetTop + bin.offsetHeight + (parseFloat(getComputedStyle(bin).marginBottom) || 0));
    if (room() < 8) bin.classList.add("small");
    if (room() < 8) bin.hidden = true;
  }

  $("#nextRound").addEventListener("click", () => {
    if (state.roundNo >= state.totalRounds) showFinal();
    else startRound();
  });

  /* ---------- Final ---------- */
  function showFinal() {
    const top = Math.max(...state.players.map((p) => p.score));
    const winners = state.players.filter((p) => p.score === top).map((p) => p.name);
    const w = $("#winnerName");
    w.textContent = joinNames(winners) + "!";
    w.classList.toggle("tie", winners.length > 1);
    $("#winnerKicker").textContent = "AFTER " + state.totalRounds + " ROUNDS, THE WINNER" + (winners.length > 1 ? "S ARE" : " IS");
    $("#trophyText").textContent = pick(TROPHY_LINES, "trophy");
    const list = $("#standings");
    list.classList.toggle("many", state.players.length > 8);
    list.innerHTML = "";
    state.players
      .map((p, idx) => ({ p, idx, r: 1 + state.players.filter((q) => q.score > p.score).length }))
      .sort((a, b) => a.r - b.r || a.idx - b.idx)
      .forEach(({ p, r }) => {
        const li = document.createElement("li");
        if (r === 1) li.className = "first";
        li.innerHTML = '<span class="place"></span><span class="n"></span><span class="p"></span>';
        li.querySelector(".place").textContent = r + (r === 1 ? "st" : r === 2 ? "nd" : r === 3 ? "rd" : "th");
        li.querySelector(".n").textContent = p.name;
        li.querySelector(".p").textContent = p.score;
        list.appendChild(li);
      });
    renderMore();
    show("final");
    confetti();
  }

  function renderMore() {
    $$("[data-more]").forEach((b) => b.classList.toggle("selected", Number(b.dataset.more) === state.more));
    $("#playMore").textContent = "Play " + state.more + " more round" + (state.more === 1 ? "" : "s");
  }
  $$("[data-more]").forEach((b) => b.addEventListener("click", () => { state.more = Number(b.dataset.more); renderMore(); }));
  $("#playMore").addEventListener("click", () => { state.totalRounds += state.more; play("start"); startRound(); });
  $("#newGame").addEventListener("click", () => { resetGame(); renderSetup(); show("setup"); });

  function resetGame() {
    state.players = [];
    state.roundNo = 0;
    if (state.chosenRounds) state.totalRounds = state.chosenRounds;
  }

  function confetti() {
    const box = $("#confetti");
    const colors = ["#DD90BE", "#F2E9DB", "#191348", "#711611"];
    for (let i = 0; i < 70; i++) {
      const c = document.createElement("span");
      c.className = "confetti";
      c.style.left = Math.random() * 390 + "px";
      c.style.background = colors[i % colors.length];
      c.style.animationDelay = Math.random() * 0.6 + "s";
      c.style.animationDuration = 1.2 + Math.random() * 0.9 + "s";
      box.appendChild(c);
      setTimeout(() => c.remove(), 3000);
    }
  }

  /* ---------- Menu & rules ---------- */
  const menu = $("#menu"), rules = $("#rules");
  let endArmed = false;
  function resetEnd() { endArmed = false; $("#endLabel").textContent = "End game"; }
  $$(".menu-btn").forEach((b) => b.addEventListener("click", () => { resetEnd(); menu.hidden = false; }));
  menu.addEventListener("click", (e) => { if (e.target === menu) menu.hidden = true; });
  rules.addEventListener("click", (e) => { if (e.target === rules) rules.hidden = true; });
  $$("[data-rules]").forEach((b) => b.addEventListener("click", () => { menu.hidden = true; rules.hidden = false; }));
  $("#closeRules").addEventListener("click", () => (rules.hidden = true));
  $("#soundRow").addEventListener("click", () => {
    state.sound = !state.sound;
    $("#soundSwitch").classList.toggle("on", state.sound);
    store.set("uc_sound", state.sound ? "1" : "0");
  });
  $("#endGame").addEventListener("click", () => {
    if (!endArmed) { endArmed = true; $("#endLabel").textContent = "Tap again to end game"; return; }
    menu.hidden = true;
    resetEnd();
    resetGame();
    show("welcome");
  });

  /* ---------- Boot ---------- */
  if (store.get("uc_sound") === "0") { state.sound = false; $("#soundSwitch").classList.remove("on"); }
  renderSetup();
})();
