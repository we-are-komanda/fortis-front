"use client";

import { useDefenseProjectStore } from "@/shared/lib/use-defense-project-store";
import { useState } from "react";
import { SaveOutlined } from "@ant-design/icons";
import { Button, theme } from "antd";
import { useDefenseVariantsStore } from "@/modules/drone-defense/domain/use-defense-variants-store";
import { VariantsModal } from "@/modules/drone-defense/ui/variants-modal";

function useVariantMeta() {
  const { token } = theme.useToken();
  const { activeVariantId, activeVariantName, saveStatus, overwriteActiveVariant } =
    useDefenseVariantsStore();

  const accessError = useDefenseProjectStore((state) => state.accessError);
  const syncStatus = useDefenseProjectStore((state) => state.syncStatus);
  const isDraft = !activeVariantId;
  const saving = saveStatus === "saving";
  const label = accessError ? "Проект недоступен" : saveStatus === "error" ? "Ошибка сохранения" : syncStatus === "unverified" ? "Черновик (не подтверждён)" : isDraft || syncStatus === "dirty" ? "Есть несохранённые изменения" : activeVariantName;
  const dotColor = saveStatus === "error" ? token.colorError : isDraft || syncStatus !== "saved" ? token.colorWarning : token.colorSuccess;

  return {
    token,
    accessError,
    activeVariantId,
    activeVariantName,
    saveStatus,
    overwriteActiveVariant,
    isDraft,
    saving,
    label,
    dotColor,
  };
}

export function VariantStatusButton({
  fullWidth = false,
}: {
  fullWidth?: boolean;
}) {
  const { token, isDraft, label, dotColor } = useVariantMeta();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Открыть варианты конфигурации"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: token.marginXS,
          width: fullWidth ? "100%" : undefined,
          justifyContent: fullWidth ? "space-between" : undefined,
          minWidth: 0,
          maxWidth: fullWidth ? undefined : 200,
          height: token.controlHeight,
          paddingInline: token.paddingSM,
          background: token.colorFillQuaternary,
          border: `1px solid ${token.colorBorderSecondary}`,
          borderRadius: token.borderRadiusLG,
          color: token.colorText,
          cursor: "pointer",
          font: "inherit",
          fontSize: token.fontSize,
          lineHeight: 1,
          transition: `border-color ${token.motionDurationMid}, background ${token.motionDurationMid}`,
        }}
        onMouseEnter={(event) => {
          event.currentTarget.style.borderColor = token.colorPrimaryBorderHover;
          event.currentTarget.style.background = token.colorFillTertiary;
        }}
        onMouseLeave={(event) => {
          event.currentTarget.style.borderColor = token.colorBorderSecondary;
          event.currentTarget.style.background = token.colorFillQuaternary;
        }}
      >
        <span
          aria-hidden
          style={{
            flexShrink: 0,
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: dotColor,
            boxShadow: `0 0 0 3px ${dotColor}1f`,
          }}
        />
        <span
          style={{
            minWidth: 0,
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontWeight: token.fontWeightStrong,
            color: isDraft ? token.colorTextSecondary : token.colorText,
          }}
        >
          {label}
        </span>
        <span
          aria-hidden
          style={{ flexShrink: 0, color: token.colorTextTertiary, fontSize: token.fontSizeSM }}
        >
          ▾
        </span>
      </button>
      <VariantsModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export function VariantSaveButton({
  iconOnly = false,
  className,
}: {
  iconOnly?: boolean;
  className?: string;
}) {
  const { activeVariantName, overwriteActiveVariant, isDraft, saving, accessError } = useVariantMeta();
  const [open, setOpen] = useState(false);

  const handleSave = () => {
    if (isDraft) {
      setOpen(true);
      return;
    }
    void overwriteActiveVariant();
  };

  return (
    <>
      {iconOnly ? (
        <button
          className={className}
          type="button"
          onClick={handleSave}
          disabled={saving || Boolean(accessError)}
          title={
            isDraft
              ? "Сохранить карту как новый вариант"
              : `Сохранить вариант «${activeVariantName ?? "текущий"}»`
          }
          aria-label={isDraft ? "Сохранить карту как новый вариант" : "Сохранить текущий вариант"}
        >
          <SaveOutlined />
        </button>
      ) : (
        <Button type="primary" onClick={handleSave} loading={saving} disabled={Boolean(accessError)}>
          Сохранить
        </Button>
      )}
      <VariantsModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export function VariantSelector() {
  const { saving, accessError } = useVariantMeta();
  const [open, setOpen] = useState(false);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexWrap: "wrap",
      }}
    >
      <VariantStatusButton />
      <VariantSaveButton />
      <Button size="small" onClick={() => setOpen(true)} disabled={saving || Boolean(accessError)}>
        Сохранить как…
      </Button>
      <VariantsModal open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
