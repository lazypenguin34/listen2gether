#ifndef ROOMMANAGER_H
#define ROOMMANAGER_H
#include <string>
#include <random>
#include <unordered_map>
#include <ctime>

struct Room {
    const std::string hostPlatform;
    int positionMs;
    std::string artistName;
    std::string trackName;
    std::time_t lastInspectionTimestamp;
};

class RoomManager {
private:
    std::unordered_map<int, Room> rooms;
    std::pair<int, int> roomCodeRange; // inclusive
public:
    // Constructor
    explicit RoomManager(const std::pair<int, int> &roomCodeRange) : rooms(), roomCodeRange(roomCodeRange) {}

    /*
     * Creates a room with a unique, random room code
     * Returns the roomcode
     */
    int createRoom(const std::string& hostPlatform, const std::string& artistName, const std::string& trackName) {
        // Generate a random room code
        static std::random_device rd;
        static std::mt19937 gen(rd());
        std::uniform_int_distribution<> dist(roomCodeRange.first, roomCodeRange.second);

        int roomCode;
        do {
            roomCode = dist(gen);
        } while (rooms.find(roomCode) != rooms.end());

        rooms.emplace(roomCode, Room{hostPlatform, 0, artistName, trackName, std::time(nullptr)});
        return roomCode;
    }

    void removeRoom(const int roomCode) {
        rooms.erase(roomCode);
    }

    Room& getRoom(const int roomCode) {
        return rooms.at(roomCode);
    }

    void inspectRooms() {
        std::time_t currTime = std::time(nullptr);

        for (const std::pair<const int, Room>& roomPair: rooms) {
            Room room = roomPair.second;
            long timeDifference = currTime - room.lastInspectionTimestamp;

            if (timeDifference > 600) { // 10 minutes
                removeRoom(roomPair.first);
            }
        }
    }
};

#endif //ROOMMANAGER_H
