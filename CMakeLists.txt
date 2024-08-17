cmake_minimum_required(VERSION 3.28)
project(listen2gether)

set(CMAKE_CXX_STANDARD 17)

add_executable(listen2gether
        main.cpp
        RoomManager.h
)

find_package(Crow REQUIRED)
target_link_libraries(listen2gether PUBLIC Crow::Crow)
