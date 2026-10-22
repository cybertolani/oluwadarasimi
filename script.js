
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://sswagsfklxwtomdvglzb.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_nFM9hU_05c94Gd5QrsQTTg_bCOR2qHX";

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const $ = (id) => document.getElementById(id);

let currentUser = null;
let coupleSpace = null;
let busy = false;

function status(id, message) {
  $(id).textContent = message;
}

function showAuth() {
  $("auth").hidden = false;
  $("setup").hidden = true;
  $("workspace").hidden = true;
  $("logout").hidden = true;
}

function showSetup() {
  $("auth").hidden = true;
  $("setup").hidden = false;
  $("workspace").hidden = true;
  $("logout").hidden = true;
}

function showWorkspace() {
  $("auth").hidden = true;
  $("setup").hidden = true;
  $("workspace").hidden = false;
  $("logout").hidden = false;
}

function escapeTime(value) {
  return new Date(value).toLocaleString([], {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
}

async function loadSpace(user) {
  if (busy) return;
  busy = true;

  try {
    currentUser = user;

    // Find only a space that belongs to this signed-in user.
    const { data: spaces, error } = await supabase
      .from("couple_spaces")
      .select("id, created_by, partner_user_id, invite_code")
      .or(`created_by.eq.${user.id},partner_user_id.eq.${user.id}`)
      .limit(2);

    if (error) {
      console.error(error);
      showAuth();
      status("authStatus", "Couldn't load your space. Check Supabase policies.");
      return;
    }

    if (spaces.length > 1) {
      showSetup();
      status("setupStatus", "This account belongs to more than one space. Please stop and ask me to help fix it.");
      return;
    }

    if (spaces.length === 0) {
      coupleSpace = null;
      showSetup();
      status("setupStatus", "Create your space or join your partner with their invite code.");
      return;
    }

    coupleSpace = spaces[0];
    showWorkspace();

    if (coupleSpace.partner_user_id) {
      $("chatStatus").textContent = "Your shared private space ♡";
      $("invitePanel").hidden = true;
    } else {
      $("chatStatus").textContent = "Waiting for your partner to join ♡";
      $("inviteCodeDisplay").textContent = coupleSpace.invite_code;
      $("invitePanel").hidden = false;
    }

    await Promise.all([loadPosts(), loadMessages()]);
  } finally {
    busy = false;
  }
}

// Account creation.
$("signup").addEventListener("click", async () => {
  const email = $("email").value.trim();
  const password = $("password").value;

  if (!email || password.length < 6) {
    status("authStatus", "Enter your email and a password of at least 6 characters.");
    return;
  }

  status("authStatus", "Creating your account...");

  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error) {
    status("authStatus", error.message);
    return;
  }

  if (data.session) {
    await loadSpace(data.session.user);
  } else {
    status("authStatus", "Check your email to confirm your account, then sign in.");
  }
});

// Login.
$("authForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  status("authStatus", "Signing in...");

  const { data, error } = await supabase.auth.signInWithPassword({
    email: $("email").value.trim(),
    password: $("password").value
  });

  if (error) {
    status("authStatus", error.message);
    return;
  }

  await loadSpace(data.user);
});

// Create the shared space.
$("createSpace").addEventListener("click", async () => {
  if (!currentUser || coupleSpace) return;

  status("setupStatus", "Creating your space...");

  const { error } = await supabase
    .from("couple_spaces")
    .insert({ created_by: currentUser.id });

  if (error) {
    console.error(error);
    status("setupStatus", "Couldn't create your space. Check the SQL setup.");
    return;
  }

  await loadSpace(currentUser);
});

// Join the partner's space.
$("joinSpace").addEventListener("click", async () => {
  if (!currentUser) return;

  const code = $("inviteCode").value.trim();

  if (!/^[A-Za-z0-9]{8}$/.test(code)) {
    status("setupStatus", "Enter the complete 8-character invite code.");
    return;
  }

  status("setupStatus", "Connecting your accounts...");

  const { error } = await supabase.rpc("claim_couple_space", {
    code: code.toUpperCase()
  });

  if (error) {
    console.error(error);
    status("setupStatus", "Couldn't join. Check the code and confirm it hasn't been used.");
    return;
  }

  await loadSpace(currentUser);
});

// Copy the invite code.
$("copyInvite").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("inviteCodeDisplay").textContent);
    status("setupStatus", "Invite code copied.");
  } catch {
    status("setupStatus", "Copy unavailable. Select and copy the displayed code manually.");
  }
});

// Switch between Feed and Messenger.
document.querySelectorAll(".tab").forEach((button) => {
  button.addEventListener("click", () => {
    const isFeed = button.dataset.tab === "feed";

    document.querySelectorAll(".tab").forEach((tab) => {
      tab.classList.toggle("active", tab === button);
    });

    $("feedPage").hidden = !isFeed;
    $("chatPage").hidden = isFeed;
  });
});

// Load feed posts and their likes.
async function loadPosts() {
  if (!coupleSpace || !currentUser) return;

  const feed = $("feedPosts");
  feed.replaceChildren();

  const { data: posts, error } = await supabase
    .from("couple_posts")
    .select("id, author_id, content, created_at")
    .eq("couple_space_id", coupleSpace.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    status("feedStatus", "Couldn't load the feed. Check the database setup.");
    return;
  }

  status("feedStatus", "");

  if (!posts.length) {
    const empty = document.createElement("p");
    empty.className = "empty card";
    empty.textContent = "Your first shared moment belongs here 💕";
    feed.appendChild(empty);
    return;
  }

  const postIds = posts.map((post) => post.id);

  const { data: likes, error: likesError } = await supabase
    .from("couple_post_likes")
    .select("post_id, user_id")
    .in("post_id", postIds);

  if (likesError) {
    console.error(likesError);
    status("feedStatus", "Posts loaded, but likes could not be loaded.");
  }

  for (const post of posts) {
    const postLikes = (likes || []).filter((like) => like.post_id === post.id);
    const likedByMe = postLikes.some((like) => like.user_id === currentUser.id);

    const card = document.createElement("article");
    card.className = "post card";

    const header = document.createElement("div");
    header.className = "post-header";

    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent = "💗";

    const author = document.createElement("div");
    author.className = "post-author";

    const name = document.createElement("strong");
    name.textContent = post.author_id === currentUser.id
      ? "You"
      : "Oluwadarasimi";

    const date = document.createElement("div");
    date.className = "post-date";
    date.textContent = escapeTime(post.created_at);

    author.append(name, date);
    header.append(avatar, author);

    const content = document.createElement("p");
    content.className = "post-content";
    content.textContent = post.content;

    const actions = document.createElement("div");
    actions.className = "post-actions";

    const likeButton = document.createElement("button");
    likeButton.className = `like-button${likedByMe ? " liked" : ""}`;
    likeButton.textContent = likedByMe ? "♥ Liked" : "♡ Like";
    likeButton.type = "button";

    const count = document.createElement("span");
    count.className = "like-count";
    count.textContent = `${postLikes.length} ${postLikes.length === 1 ? "like" : "likes"}`;

    likeButton.addEventListener("click", async () => {
      likeButton.disabled = true;

      let result;

      if (likedByMe) {
        result = await supabase
          .from("couple_post_likes")
          .delete()
          .eq("post_id", post.id)
          .eq("user_id", currentUser.id);
      } else {
        result = await supabase
          .from("couple_post_likes")
          .insert({ post_id: post.id, user_id: currentUser.id });
      }

      likeButton.disabled = false;

      if (result.error) {
        console.error(result.error);
        status("feedStatus", "Couldn't update the like. Please try again.");
        return;
      }

      await loadPosts();
    });

    actions.append(likeButton, count);
    card.append(header, content, actions);
    feed.appendChild(card);
  }
}

// Publish a feed post.
$("postForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const content = $("postInput").value.trim();
  if (!content || !currentUser || !coupleSpace) return;

  const button = event.submitter;
  if (button) button.disabled = true;

  const { error } = await supabase
    .from("couple_posts")
    .insert({
      couple_space_id: coupleSpace.id,
      author_id: currentUser.id,
      content
    });

  if (button) button.disabled = false;

  if (error) {
    console.error(error);
    status("feedStatus", "Couldn't publish your post. Please try again.");
    return;
  }

  $("postInput").value = "";
  status("feedStatus", "Your moment has been posted 💗");
  await loadPosts();
});

// Load shared messages.
async function loadMessages() {
  if (!coupleSpace || !currentUser) return;

  const box = $("messages");
  box.replaceChildren();

  const { data, error } = await supabase
    .from("love_messages")
    .select("id, message, sender_id, created_at")
    .eq("couple_space_id", coupleSpace.id)
    .order("created_at", { ascending: true });

  if (error) {
    console.error(error);
    box.textContent = "Couldn't load messages. Please refresh.";
    return;
  }

  if (!data.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "Your first love note is waiting 💗";
    box.appendChild(empty);
    return;
  }

  for (const item of data) {
    const row = document.createElement("div");
    row.className = "message-row";

    const mine = item.sender_id === currentUser.id;
    if (mine) row.classList.add("mine");

    const bubble = document.createElement("div");
    bubble.className = "message-bubble";
    bubble.textContent = item.message;

    const meta = document.createElement("div");
    meta.className = "message-meta";
    meta.textContent = `${mine ? "You" : "Oluwadarasimi"} · ${escapeTime(item.created_at)}`;

    row.append(bubble, meta);
    box.appendChild(row);
  }

  box.scrollTop = box.scrollHeight;
}

// Send a chat message.
$("messageForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const message = $("messageInput").value.trim();
  if (!message || !currentUser || !coupleSpace) return;

  const button = document.querySelector(".send-button");
  button.disabled = true;

  const { error } = await supabase
    .from("love_messages")
    .insert({
      couple_space_id: coupleSpace.id,
      sender_id: currentUser.id,
      message
    });

  button.disabled = false;

  if (error) {
    console.error(error);
    alert("Message could not be sent. Please try again.");
    return;
  }

  $("messageInput").value = "";
  await loadMessages();
});

$("refreshChat").addEventListener("click", loadMessages);

// Sign out.
$("logout").addEventListener("click", async () => {
  const { error } = await supabase.auth.signOut();

  if (error) {
    console.error(error);
    alert("Couldn't sign out. Please try again.");
    return;
  }

  currentUser = null;
  coupleSpace = null;
  showAuth();
});

// Restore an existing login.
const { data: sessionData, error: sessionError } =
  await supabase.auth.getSession();

if (sessionError) {
  status("authStatus", "Couldn't restore your session. Please sign in again.");
}

if (sessionData?.session?.user) {
  await loadSpace(sessionData.session.user);
} else {
  showAuth();
}

// Update the interface when authentication changes.
supabase.auth.onAuthStateChange((event, session) => {
  if (event === "SIGNED_OUT") {
    currentUser = null;
    coupleSpace = null;
    showAuth();
  } else if (event === "SIGNED_IN" && session?.user) {
    void loadSpace(session.user);
  }
});
