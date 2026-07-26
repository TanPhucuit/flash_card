from __future__ import annotations

import hashlib


SECRET_SALT = "LocalEnglish_ToolBoxGiaRe_Lifetime_2026#pL4"


def generate_activation_key(machine_code: str) -> str:
    normalized = machine_code.strip().upper()
    digest = hashlib.sha256(f"{normalized}|{SECRET_SALT}".encode("utf-8")).hexdigest().upper()
    return "KEY-" + "-".join(digest[i : i + 4] for i in range(0, 16, 4))


def main() -> None:
    print("=== Local English - Activation Key Generator ===")
    machine_code = input("Nhap ma may khach gui: ").strip().upper()
    if not machine_code:
        print("Ma may khong duoc de trong.")
        return

    activation_key = generate_activation_key(machine_code)
    print()
    print("Ma kich hoat:")
    print(activation_key)


if __name__ == "__main__":
    main()
