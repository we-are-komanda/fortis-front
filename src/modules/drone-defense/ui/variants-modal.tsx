"use client";

import { useEffect, useState } from "react";
import { CheckCircleFilled } from "@ant-design/icons";
import { Alert, Button, Input, Modal, Spin, Tag, Typography, theme } from "antd";
import { useDefenseVariantsStore } from "@/modules/drone-defense/domain/use-defense-variants-store";
import { useDefenseProjectStore } from "@/shared/lib/use-defense-project-store";
import type { VariantSummary } from "@/shared/types/defense-project";

type Props = { open: boolean; onClose: () => void };

function formatUpdatedAt(updatedAt: string): string {
  return new Date(updatedAt).toLocaleDateString("ru-RU");
}

export function VariantsModal({ open, onClose }: Props) {
  const {
    variants,
    activeVariantId,
    listStatus,
    saveStatus,
    conflictState,
    error,
    requestId,
    recoveryDraft,
    recoveryStatus,
    recoveryError,
    fetchVariants,
    checkRecoveryDraft,
    clearRecoveryDraft,
    saveAsNewVariant,
    overwriteActiveVariant,
    loadVariant,
    deleteVariant,
  } = useDefenseVariantsStore();
  const { token } = theme.useToken();
  const syncStatus = useDefenseProjectStore((state) => state.syncStatus);
  const saveAttempt = useDefenseProjectStore((state) => state.saveAttempt);
  const restoreVerifiedDraft = useDefenseProjectStore((state) => state.restoreVerifiedDraft);
  const [newName, setNewName] = useState("");
  const [pendingLoadId, setPendingLoadId] = useState<string | null>(null);
  const [transitionSaveName, setTransitionSaveName] = useState("");
  const [transitionBusy, setTransitionBusy] = useState(false);

  useEffect(() => {
    if (open) void Promise.all([fetchVariants(), checkRecoveryDraft()]);
  }, [open, fetchVariants, checkRecoveryDraft]);

  const saving = saveStatus === "saving";
  const trimmedName = newName.trim();
  const canSave = trimmedName.length > 0 && !saving;
  const transitionRequired = syncStatus === "dirty" || saving || saveAttempt !== null;

  const handleSave = async () => {
    if (!canSave) return;
    const before = useDefenseVariantsStore.getState().activeVariantId;
    await saveAsNewVariant(trimmedName);
    const after = useDefenseVariantsStore.getState();
    if (after.saveStatus === "idle" && after.activeVariantId && after.activeVariantId !== before) setNewName("");
  };

  const performLoad = async (id: string) => {
    await loadVariant(id);
    const state = useDefenseVariantsStore.getState();
    if (state.loadStatus === "idle" && state.activeVariantId === id) {
      clearRecoveryDraft();
      setPendingLoadId(null);
      onClose();
    }
  };

  const requestLoad = (id: string) => {
    if (id === activeVariantId) return;
    if (!transitionRequired) {
      void performLoad(id);
      return;
    }
    setTransitionSaveName(useDefenseProjectStore.getState().project.projectName);
    setPendingLoadId(id);
  };

  const resolveLoadTransition = async (choice: "stay" | "discard" | "save") => {
    const targetId = pendingLoadId;
    if (!targetId || transitionBusy) return;
    if (choice === "stay") {
      setPendingLoadId(null);
      return;
    }
    setTransitionBusy(true);
    try {
      if (choice === "discard") {
        await performLoad(targetId);
        return;
      }
      const current = useDefenseProjectStore.getState();
      const activeId = useDefenseVariantsStore.getState().activeVariantId;
      if (activeId) await overwriteActiveVariant();
      else if (transitionSaveName.trim()) await saveAsNewVariant(transitionSaveName.trim());
      const afterProject = useDefenseProjectStore.getState();
      const afterVariants = useDefenseVariantsStore.getState();
      const saveCompleted = afterVariants.saveStatus === "idle" && !afterVariants.error && afterProject.syncStatus === "saved" && afterProject.project.projectId !== current.project.projectId;
      const overwriteCompleted = afterVariants.saveStatus === "idle" && !afterVariants.error && afterProject.syncStatus === "saved" && afterProject.project.projectId === current.project.projectId;
      if (saveCompleted || overwriteCompleted) await performLoad(targetId);
    } finally {
      setTransitionBusy(false);
    }
  };

  const restoreDraft = () => {
    const record = recoveryDraft;
    if (!record) return;
    const confirmRestore = () => {
      const current = useDefenseProjectStore.getState();
      const variantState = useDefenseVariantsStore.getState();
      if (current.identityId !== record.userId || current.project.projectId !== record.projectId || current.project.enterpriseId !== record.enterpriseId || variantState.activeVariantId !== record.projectId) {
        clearRecoveryDraft();
        return;
      }
      restoreVerifiedDraft(record);
      clearRecoveryDraft();
    };
    if (syncStatus === "dirty" || saving) {
      Modal.confirm({ title: "Заменить текущие несохранённые изменения?", content: "Локальный черновик будет восстановлен поверх открытого проекта. Серверная версия останется без изменений до явного сохранения.", okText: "Восстановить черновик", cancelText: "Остаться", onOk: confirmRestore });
    } else confirmRestore();
  };

  return (
    <Modal
      open={open}
      onCancel={() => { setPendingLoadId(null); onClose(); }}
      title="Варианты конфигурации"
      footer={null}
      width={520}
      destroyOnHidden
    >
      {error ? (
        <Alert
          type="error"
          message={error}
          action={
            conflictState ? (
              <Button size="small" danger onClick={() => requestLoad(conflictState.projectId)}>
                Перезагрузить актуальную версию
              </Button>
            ) : saveAttempt ? (
              <Button size="small" onClick={() => void (saveAttempt.kind === "create" ? saveAsNewVariant(saveAttempt.name) : overwriteActiveVariant())}>
                Повторить сохранение
              </Button>
            ) : undefined
          }
          description={requestId ? `Код запроса: ${requestId}` : undefined}
          showIcon
          style={{ marginBottom: token.marginMD }}
        />
      ) : null}

      {recoveryStatus === "loading" ? <div role="status" style={{ marginBottom: token.marginMD }}><Spin size="small" /> <Typography.Text type="secondary">Проверяем локальный черновик…</Typography.Text></div> : null}
      {recoveryError ? <Alert type="warning" showIcon message="Локальное восстановление недоступно" description={recoveryError} style={{ marginBottom: token.marginMD }} /> : null}
      {recoveryDraft ? (
        <Alert
          type="warning"
          showIcon
          message="Найден локальный несохранённый черновик"
          description="Доступ к серверному проекту подтверждён. Можно явно восстановить локальные изменения; они не отправятся на сервер автоматически."
          action={<Button size="small" onClick={restoreDraft}>Восстановить</Button>}
          style={{ marginBottom: token.marginMD }}
        />
      ) : null}

      <VariantsBody
        variants={variants}
        activeVariantId={activeVariantId}
        listStatus={listStatus}
        token={token}
        onLoad={requestLoad}
        onDelete={(id) => void deleteVariant(id)}
      />

      <div
        style={{
          marginTop: token.marginLG,
          paddingTop: token.marginMD,
          borderTop: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <Typography.Text
          strong
          style={{ display: "block", marginBottom: token.marginXS }}
        >
          Сохранить текущую карту
        </Typography.Text>
        <div style={{ display: "flex", gap: token.marginXS }}>
          <Input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            onPressEnter={handleSave}
            placeholder="Имя нового варианта…"
            disabled={saving}
            maxLength={120}
          />
          <Button
            type="primary"
            onClick={handleSave}
            disabled={!canSave}
            loading={saving}
          >
            Сохранить как новый
          </Button>
        </div>
      </div>
      <Modal
        open={pendingLoadId !== null}
        title="Есть несохранённые изменения"
        onCancel={() => void resolveLoadTransition("stay")}
        footer={[
          <Button key="stay" onClick={() => void resolveLoadTransition("stay")} disabled={transitionBusy}>Остаться</Button>,
          <Button key="discard" danger onClick={() => void resolveLoadTransition("discard")} loading={transitionBusy}>Отказаться и открыть</Button>,
          <Button key="save" type="primary" onClick={() => void resolveLoadTransition("save")} loading={transitionBusy} disabled={!activeVariantId && !transitionSaveName.trim()}>Сохранить и открыть</Button>,
        ]}
      >
        <Typography.Paragraph>Сохраните текущий вариант, останьтесь здесь или явно откажитесь от локальных изменений перед открытием другого проекта.</Typography.Paragraph>
        {!activeVariantId ? <Input aria-label="Имя нового варианта перед переходом" value={transitionSaveName} onChange={(event) => setTransitionSaveName(event.target.value)} maxLength={120} /> : null}
      </Modal>
    </Modal>
  );
}

type VariantsBodyProps = {
  variants: VariantSummary[];
  activeVariantId: string | null;
  listStatus: "idle" | "loading" | "error";
  token: ReturnType<typeof theme.useToken>["token"];
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
};

function VariantsBody({
  variants,
  activeVariantId,
  listStatus,
  token,
  onLoad,
  onDelete,
}: VariantsBodyProps) {
  if (listStatus === "loading") {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: token.marginSM,
          padding: `${token.paddingXL}px 0`,
        }}
      >
        <Spin />
        <Typography.Text type="secondary">Загрузка списка…</Typography.Text>
      </div>
    );
  }

  if (variants.length === 0) {
    return (
      <div
        style={{
          padding: `${token.paddingXL}px ${token.paddingLG}px`,
          textAlign: "center",
        }}
      >
        <Typography.Text type="secondary">
          Пока нет сохранённых вариантов. Сохраните текущую карту как первый
          вариант ниже.
        </Typography.Text>
      </div>
    );
  }

  return (
    <ul
      style={{
        listStyle: "none",
        margin: 0,
        padding: 0,
        maxHeight: 360,
        overflowY: "auto",
        marginInline: -token.paddingContentHorizontalLG,
      }}
    >
      {variants.map((variant) => {
        const isActive = variant.projectId === activeVariantId;
        return (
          <li
            key={variant.projectId}
            style={{
              display: "flex",
              alignItems: "center",
              gap: token.marginSM,
              paddingBlock: token.paddingSM,
              paddingInline: token.paddingContentHorizontalLG,
              borderBottom: `1px solid ${token.colorBorderSecondary}`,
              background: isActive ? token.colorPrimaryBg : undefined,
              transition: `background ${token.motionDurationMid}`,
            }}
          >
            {isActive ? (
              <CheckCircleFilled
                style={{ color: token.colorPrimary, fontSize: token.fontSizeLG }}
              />
            ) : null}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: token.marginXS,
                }}
              >
                <Typography.Text strong>{variant.name}</Typography.Text>
                {isActive ? (
                  <Tag color="processing" style={{ marginInlineEnd: 0 }}>
                    Текущий
                  </Tag>
                ) : null}
              </div>
              <Typography.Text
                type="secondary"
                style={{ display: "block", fontSize: token.fontSizeSM }}
              >
                {`v${variant.version} · ${formatUpdatedAt(variant.updatedAt)}`}
              </Typography.Text>
            </div>
            <Button type="link" size="small" onClick={() => onLoad(variant.projectId)}>
              Загрузить
            </Button>
            <Button
              type="link"
              size="small"
              danger
              onClick={() => onDelete(variant.projectId)}
            >
              Удалить
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
