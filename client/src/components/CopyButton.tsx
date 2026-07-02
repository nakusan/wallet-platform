import { useState } from 'react'

export function CopyButton(props: { value: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <button
      type="button"
      className={props.className ?? 'btn btn-small'}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(props.value)
          setCopied(true)
          setTimeout(() => setCopied(false), 800)
        } catch {
          // ignore
        }
      }}
      title={props.value}
    >
      {copied ? '已复制' : (props.label ?? '复制')}
    </button>
  )
}

