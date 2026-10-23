import type { SettingSection } from "@/types/settings-schema";
import { IS_APPX } from "@/utils/config";

export const updateSection: SettingSection = {
  id: "update",
  visible: () => !IS_APPX,
  items: [
    {
      key: "autoCheckUpdate",
      type: "switch",
      binding: { store: "settings", path: "system.update.autoCheck" },
      defaultValue: true,
    },
  ],
};
