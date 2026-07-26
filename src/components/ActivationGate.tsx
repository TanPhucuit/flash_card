import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { generateActivationKey, getMachineCode, isActivated, saveActivationKey } from "../utils/activation";
import { Button, Card, Icon, Input } from "./ui";

export function ActivationGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [machineCode, setMachineCode] = useState("");
  const [key, setKey] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let mounted = true;
    async function load() {
      const [active, code] = await Promise.all([isActivated(), getMachineCode()]);
      if (!mounted) return;
      setUnlocked(active);
      setMachineCode(code);
      setReady(true);
    }
    load();
    return () => {
      mounted = false;
    };
  }, []);

  async function activate() {
    const expectedKey = await generateActivationKey(machineCode);
    if (key.trim().toUpperCase() !== expectedKey) {
      setMessage("Mã kích hoạt sai hoặc không đúng với máy này.");
      return;
    }
    saveActivationKey(key);
    setUnlocked(true);
  }

  async function copyMachineCode() {
    await navigator.clipboard.writeText(machineCode);
    setMessage("Đã copy mã máy.");
  }

  if (!ready) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-md dark:bg-[#191c1d]">
        <div className="text-on-surface-variant dark:text-white/70">Đang kiểm tra bản quyền...</div>
      </main>
    );
  }

  if (unlocked) return <>{children}</>;

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-md py-xl text-on-background dark:bg-[#191c1d] dark:text-white">
      <Card className="w-full max-w-xl">
        <div className="mb-lg flex items-center gap-md">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-white">
            <Icon name="lock" />
          </span>
          <div>
            <h1 className="font-headline-md text-2xl font-bold">Kích hoạt Local English</h1>
            <p className="mt-xs text-on-surface-variant dark:text-white/65">
              Gửi mã máy cho admin để nhận mã kích hoạt vĩnh viễn.
            </p>
          </div>
        </div>

        <div className="rounded-xl bg-surface-container-low p-md dark:bg-white/5">
          <div className="text-sm font-semibold text-on-surface-variant dark:text-white/60">Mã máy</div>
          <div className="mt-xs flex flex-col gap-sm sm:flex-row sm:items-center">
            <code className="min-w-0 flex-1 break-all rounded-lg bg-white px-md py-sm font-bold text-primary dark:bg-[#202324] dark:text-[#c3c0ff]">
              {machineCode}
            </code>
            <Button type="button" variant="secondary" onClick={copyMachineCode}>
              <Icon name="content_copy" /> Copy
            </Button>
          </div>
        </div>

        <div className="mt-lg space-y-sm">
          <label className="block font-semibold" htmlFor="activation-key">
            Mã kích hoạt
          </label>
          <Input
            id="activation-key"
            value={key}
            onChange={(event) => {
              setKey(event.target.value);
              setMessage("");
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") activate();
            }}
            placeholder="KEY-XXXX-XXXX-XXXX-XXXX"
          />
          {message ? <p className="text-sm font-semibold text-primary dark:text-[#c3c0ff]">{message}</p> : null}
        </div>

        <Button type="button" onClick={activate} className="mt-lg min-h-12 w-full">
          <Icon name="verified_user" /> Kích hoạt
        </Button>
      </Card>
    </main>
  );
}
