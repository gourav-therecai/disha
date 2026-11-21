from hashlib import sha256
from unicodedata import normalize


class AllocationConflict(ValueError):
    pass


def allocation_key(google_id, name, address):
    if google_id:
        return "google:" + sha256(google_id.encode()).hexdigest()

    def cleaned(value):
        return " ".join(normalize("NFKC", value).casefold().split())

    identity = cleaned(name) + "\n" + cleaned(address)
    return "manual:" + sha256(identity.encode()).hexdigest()
