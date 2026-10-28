<script setup lang="ts">
import { toast } from "@/composables/useToast";
import { openExternal } from "@/utils/url";
import { useSortable } from "@vueuse/integrations/useSortable";
import { DEFAULT_AMLL_DB_SERVERS } from "@shared/defaults/lyrics";
import { isValidTtmlServer, normalizeTtmlServers } from "@shared/utils/ttmlServer";

defineOptions({ inheritAttrs: false });

const props = defineProps<{ modelValue: string[] | string }>();
const emit = defineEmits<{ "update:modelValue": [value: string[]] }>();

const { t } = useI18n();

const open = ref(false);
const servers = ref<{ id: number; url: string }[]>([]);
const listEl = ref<HTMLElement | null>(null);
let nextId = 0;

watch(open, (val) => {
  if (val) {
    servers.value = normalizeTtmlServers(props.modelValue).map((url) => ({ id: nextId++, url }));
  }
});

useSortable(listEl, servers, {
  handle: ".ttml-source-handle",
  animation: 150,
  forceFallback: true,
  watchElement: true,
  fallbackClass: "sortable-ghost",
});

/** 添加一个待编辑的 TTML 源 */
const handleAdd = (): void => {
  servers.value.push({ id: nextId++, url: "" });
};

/** 恢复默认来源及其优先级，确认后才保存 */
const handleReset = (): void => {
  servers.value = DEFAULT_AMLL_DB_SERVERS.map((url) => ({ id: nextId++, url }));
};

/** 校验并保存来源列表，保留拖拽设置的顺序 */
const handleConfirm = (): void => {
  const urls = servers.value.map((server) => server.url.trim());
  if (urls.length === 0 || urls.some((url) => !isValidTtmlServer(url))) {
    toast.error(t("settings.amllDbServer.invalid"));
    return;
  }
  if (new Set(urls).size !== urls.length) {
    toast.error(t("settings.amllDbServer.duplicate"));
    return;
  }
  emit("update:modelValue", urls);
  open.value = false;
};
</script>

<template>
  <SButton type="primary" variant="secondary" size="small" @click="open = true">
    {{ t("common.configure") }}
  </SButton>
  <SDialog v-model:open="open" :title="t('settings.amllDbServer.label')" width="640px">
    <div class="flex flex-col gap-3 text-sm">
      <p>{{ t("settings.amllDbServer.hint") }}</p>
      <p class="text-on-surface-variant text-xs">
        {{ t("settings.amllDbServer.placeholders") }}
      </p>
      <div ref="listEl" class="flex flex-col gap-2.5">
        <SCard
          v-for="(server, index) in servers"
          :key="server.id"
          variant="settings"
          class="flex items-center gap-2"
        >
          <span
            class="ttml-source-handle inline-flex items-center justify-center w-5 h-8 shrink-0 cursor-grab active:cursor-grabbing text-on-surface-variant/60"
            :title="t('settings.amllDbServer.drag')"
          >
            <IconLucideGripVertical class="size-4" />
          </span>
          <span class="w-4 shrink-0 text-center text-xs text-on-surface-variant/60 tabular-nums">
            {{ index + 1 }}
          </span>
          <SInput
            v-model="server.url"
            class="flex-1 min-w-0"
            :placeholder="t('settings.amllDbServer.placeholder')"
            :aria-label="t('settings.amllDbServer.source', { index: index + 1 })"
            clearable
          />
          <SButton
            variant="ghost"
            circle
            size="small"
            :title="t('settings.amllDbServer.remove', { index: index + 1 })"
            :aria-label="t('settings.amllDbServer.remove', { index: index + 1 })"
            :disabled="servers.length === 1"
            @click="servers.splice(index, 1)"
          >
            <template #icon><IconLucideTrash2 /></template>
          </SButton>
        </SCard>
      </div>
      <SButton variant="secondary" size="small" class="self-start" @click="handleAdd">
        <template #icon><IconLucidePlus /></template>
        {{ t("settings.amllDbServer.add") }}
      </SButton>
      <p class="text-on-surface-variant">
        {{ t("settings.amllDbServer.docsHint") }}
        <a
          class="text-primary cursor-pointer hover:underline"
          @click="openExternal('https://github.com/amll-dev/amll-ttml-db')"
        >
          AMLL TTML DB
        </a>
      </p>
    </div>
    <template #footer="{ close }">
      <SButton variant="secondary" @click="handleReset">{{ t("common.reset") }}</SButton>
      <SButton variant="secondary" @click="close">{{ t("common.cancel") }}</SButton>
      <SButton type="primary" @click="handleConfirm">{{ t("common.confirm") }}</SButton>
    </template>
  </SDialog>
</template>
