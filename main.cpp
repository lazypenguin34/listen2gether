#include "RoomManager.h"
#include <iostream>

int main() {
    RoomManager roomManager(std::make_pair(0, 999));

    int code = roomManager.createRoom("YT", "Travis Scott", "Fein");
    Room room = roomManager.getRoom(code);
    std::cout << "Room Code: " << code << "\nHost Platform: " << room.hostPlatform;
}
