import json
import os
import sys
import time
import requests

# ============ НАСТРОЙКИ ============

# Для локального теста можно вписать сюда прямо значения.
# Если переменные окружения заданы (как в GitHub Actions) — они в приоритете.
BOT_TOKEN = os.environ.get("DISCORD_BOT_TOKEN", "tokem")
GUILD_ID = os.environ.get("DISCORD_GUILD_ID", "id")

# ---- СТАФФ ----
# Список ролей в порядке от старшей к младшей.
# role_id — ID роли в Discord, rank — подпись, которая выводится на сайте.
STAFF_ROLE_RANKS = [
    {"role_id": "1490676850056368189", "rank": "Президент"},
    {"role_id": "1524791150219886742", "rank": "Вице-президент"},
    {"role_id": "1490677166164410479", "rank": "Зам. Президента"},
    {"role_id": "1509517682498736299", "rank": "Председатель Гос. Думы"},
    {"role_id": "1490677108668895324", "rank": "Гос. дума"},
    {"role_id": "1493633606650695750", "rank": "Депутат"},
    # добавляй сколько нужно строк
]
STAFF_OUTPUT_FILE = "json/staffUPD"

# ---- СПОНСОРЫ ----
# role_id — ID роли спонсорского уровня в Discord.
# tier — служебный ключ тира для сайта: 'premium' / 'super' / 'standart'.
# label — человекочитаемое название (не используется сайтом напрямую,
#         но полезно для чтения этого файла).
SUPPORT_ROLE_TIERS = [
    {"role_id": "1532302002971742288", "tier": "premium", "label": "ИСР - Premium Edition"},
    {"role_id": "1532302012207861860", "tier": "super", "label": "ИСР - Super Edition"},
    {"role_id": "1532302015798186114", "tier": "standart", "label": "ИСР - Standart Edition"},
]
SUPPORT_OUTPUT_FILE = "json/supportUPD"

# ============================================================

API_BASE = "https://discord.com/api/v10"
HEADERS = {"Authorization": f"Bot {BOT_TOKEN}"}


def fetch_all_members(guild_id):
    """Постранично забирает всех участников гильдии (лимит Discord — 1000 за раз)."""
    members = []
    after = "0"
    while True:
        resp = requests.get(
            f"{API_BASE}/guilds/{guild_id}/members",
            headers=HEADERS,
            params={"limit": 1000, "after": after},
        )
        if resp.status_code == 429:
            retry_after = resp.json().get("retry_after", 1)
            print(f"Rate limit, жду {retry_after}s...")
            time.sleep(retry_after)
            continue
        resp.raise_for_status()
        batch = resp.json()
        if not batch:
            break
        members.extend(batch)
        after = batch[-1]["user"]["id"]
        if len(batch) < 1000:
            break
    return members


def avatar_url(user):
    """Строит прямую ссылку на аватар пользователя Discord."""
    if user.get("avatar"):
        ext = "gif" if user["avatar"].startswith("a_") else "png"
        return f"https://cdn.discordapp.com/avatars/{user['id']}/{user['avatar']}.{ext}?size=256"
    # Дефолтный аватар Discord, если своего нет
    default_idx = (int(user["id"]) >> 22) % 6
    return f"https://cdn.discordapp.com/embed/avatars/{default_idx}.png"


def display_name(member):
    """Никнейм на сервере, если есть, иначе имя пользователя."""
    nick = member.get("nick")
    if nick:
        return nick
    user = member["user"]
    return user.get("global_name") or user["username"]


def collect_by_roles(members, role_entries, extra_field, get_value):
    """
    Общая логика: идём по ролям в заданном порядке и собираем участников,
    у которых есть соответствующая роль. Каждый человек попадает только
    один раз — по самой старшей из своих ролей в списке.

    role_entries — список словарей с ключом 'role_id' и любым доп. полем
                   (например 'rank' для стаффа или 'tier' для спонсоров).
    extra_field  — имя итогового поля в JSON ('rank' или 'tier').
    get_value    — функция (role_entry) -> значение для extra_field.
    """
    result = []
    seen_user_ids = set()
    for role_entry in role_entries:
        role_id = role_entry["role_id"]
        value = get_value(role_entry)
        for member in members:
            user_id = member["user"]["id"]
            if role_id in member.get("roles", []) and user_id not in seen_user_ids:
                result.append({
                    "name": display_name(member),
                    extra_field: value,
                    "avatar": avatar_url(member["user"]),
                })
                seen_user_ids.add(user_id)
    return result


def main():
    if "ВСТАВЬ_СЮДА" in BOT_TOKEN or "ВСТАВЬ_СЮДА" in GUILD_ID:
        print("Заполни BOT_TOKEN и GUILD_ID в начале файла перед запуском.")
        sys.exit(1)

    print("Забираю участников сервера...")
    members = fetch_all_members(GUILD_ID)
    print(f"Всего участников: {len(members)}")

    # ---- Стафф ----
    staff = collect_by_roles(
        members, STAFF_ROLE_RANKS, "rank", lambda r: r["rank"]
    )
    with open(STAFF_OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(staff, f, ensure_ascii=False, indent=2)
    print(f"Готово! Записано {len(staff)} человек в {STAFF_OUTPUT_FILE}")

    # ---- Спонсоры ----
    support = collect_by_roles(
        members, SUPPORT_ROLE_TIERS, "tier", lambda r: r["tier"]
    )
    with open(SUPPORT_OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(support, f, ensure_ascii=False, indent=2)
    print(f"Готово! Записано {len(support)} человек в {SUPPORT_OUTPUT_FILE}")


if __name__ == "__main__":
    main()