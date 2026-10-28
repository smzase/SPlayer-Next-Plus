<script setup lang="ts">
import { useMediaStore } from "@/stores/media";
import { useSettingsStore } from "@/stores/settings";
import { openExternal } from "@/utils/url";

const media = useMediaStore();
const settings = useSettingsStore();

const credit = computed(() => {
  const authors = { kind: "authors", names: media.lyricAuthors };
  const songwriters = { kind: "songwriters", names: media.lyricSongwriters };
  switch (settings.lyric.bottomInfo) {
    case "authors":
      return authors;
    case "songwriters":
      return songwriters;
    case "preferAuthors":
      return authors.names.length ? authors : songwriters;
    case "preferSongwriters":
      return songwriters.names.length ? songwriters : authors;
    default:
      return null;
  }
});
</script>

<template>
  <div
    v-if="credit && credit.names.length > 0"
    class="w-full flex flex-wrap items-center justify-start text-left text-[max(0.5em,10px)]"
  >
    <span class="text-cover/40 select-none">
      {{ $t(credit.kind === "authors" ? "player.lyricCredit" : "player.songwriterCredit") }}
    </span>
    <template v-for="(author, idx) in credit.names" :key="author">
      <span v-if="idx > 0" class="mx-0.5 text-cover/30">,</span>
      <span
        v-if="credit.kind === 'authors'"
        class="ml-1 px-1.5 py-0.5 rounded-md cursor-pointer text-cover/50 transition-all duration-200 hover:text-cover hover:bg-cover/14 active:scale-95"
        @click.stop="openExternal(`https://github.com/${author}`)"
      >
        {{ "@" + author }}
      </span>
      <span v-else class="ml-1 px-1.5 py-0.5 text-cover/50">{{ author }}</span>
    </template>
  </div>
</template>
