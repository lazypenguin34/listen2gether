#ifndef ROOMMANAGER_H
#define ROOMMANAGER_H
#include <ctime>
#include <string>
#include <unordered_map>

struct Room {
    const std::string hostPlatform;
    int positionMs;
    std::string artistName;
    std::string trackName;
};

class RoomManager {
private:
    std::unordered_map<const int, Room> rooms;
public:
    // Blank constructor
    RoomManager() : rooms() {}

    /*
     * Creates a room with a unique, random room code
     */
    void createRoom(std::string& hostPlatform, std::string& artistName, std::string& trackName) {
        // Generate a random room code
        srand((unsigned) time(NULL));
        int roomCode;
        do {
            roomCode = rand() % 10000; // [0, 9999]
        } while (rooms.find(roomCode) != rooms.end());

        rooms.emplace(roomCode, Room{std::move(hostPlatform), 0, std::move(artistName), std::move(trackName)});
    }

    void removeRoom(const int roomCode) {
        rooms.erase(roomCode);
    }
};



#endif //ROOMMANAGER_H
