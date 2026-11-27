import { useEffect, useRef, useState } from 'react';
import { AI_TEXT } from '../../../../shared/ai/options';
import { Icon } from '../../../components/ui/Icon';

/** クリップボードへ写す（navigator.clipboard が使えないときは、見えない textarea で写す） */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 下の方法で試す */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = typeof document.execCommand === 'function' && document.execCommand('copy');
    ta.remove();
    return Boolean(ok);
  } catch {
    return false;
  }
}

/** クリップボードへコピーするボタン。押すと「コピーしました」を 2 秒出す */
export function CopyButton({ text, label = 'コピー', disabled }: { text: string; label?: string; disabled?: boolean }) {
  const [state, setState] = useState<'idle' | 'ok' | 'ng'>('idle');
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );
  return (
    <button
      type="button"
      className="btn sm"
      disabled={disabled || !text}
      onClick={async () => {
        const ok = await copyText(text);
        setState(ok ? 'ok' : 'ng');
        if (timer.current !== null) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setState('idle'), 2000);
      }}
    >
      <Icon name={state === 'ok' ? 'check' : 'copy'} size={14} />
      <span aria-live="polite">{state === 'ok' ? AI_TEXT.copied : state === 'ng' ? AI_TEXT.copyFailed : label}</span>
    </button>
  );
}
