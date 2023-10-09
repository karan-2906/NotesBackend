const asyncHandler = require('express-async-handler');
const { User } = require('../models/userModel')
const { OTP } = require('../models/otpModel')
const { Note } = require('../models/noteModel')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken');
const { sendVerificationEmail, generateverificationToken, generateOTP } = require('../utils/email')
const { resetPasswordEmail } = require('../utils/resetpasswordemail')
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const isEmailEdu = require('../utils/isEduEmail')
const { successFullVerification } = require('../utils/EmailTemplates')
require('dotenv').config();

const userInfo = asyncHandler(async (req, res) => {
    res.status(200).json({ message: 'Authentication successful', user: req.user });
});


const registerUser = asyncHandler(async (req, res) => {

    try {
        const { username, email, password, role } = req.body;
        // if (role !== "superuser" && !isEmailEdu(email)) {
        //     res.status(400).json({ "mssg": "Only vect emails are allowed" })
        //     return;
        // }

        if (!username || !email || !password) {
            res.status(400);
            throw new Error("All fields are mandatory baby");
        }

        const userAvailable = await User.findOne({ email });
        if (userAvailable) {
            res.status(400);
            throw new Error(`User with ${email} already exist`);
        }
        const verificationToken = generateverificationToken(email);
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = await User.create({
            username,
            email,
            role,
            password: hashedPassword,
            verificationToken
        });


        await sendVerificationEmail(email, verificationToken);

        res.json({ message: 'Registration successful. Please check your email for verification.', verificationToken: verificationToken, user: user });

    } catch (error) {
        res.status(500).json({ error: error.message });
        console.log(error);

    }
});

const verifyemail = async (req, res) => {
    try {
        const tokenId = req.params.tokenId;
        const user = await User.findOne({ verificationToken: tokenId });

        if (!user) {
            return res.status(404).json({ error: 'Invalid verification token.' });
        }

        user.isVerified = true;
        user.verificationToken = null;
        await user.save();

        const congratulationContent = successFullVerification();

        res.send(congratulationContent);

    } catch (error) {
        res.status(500).json({ error: 'An error occurred during email verification.' });
        console.log(error);
    }
};

//login user
const loginUser = asyncHandler(async (req, res) => {

    try {

        const { email, password } = req.body;
        if (!email || !password) {
            res.status(400).json({ message: "all fileds are required" })
        }

        const user = await User.findOne({ email });
        if (!user) {
            res.status(404).json({ message: `user with ${email} does not exist` })
        }
        const verificationToken = generateverificationToken(email);
        if (!user.isVerified) {
            res.status(403);
            user.verificationToken = verificationToken;
            await user.save();
            sendVerificationEmail(email, verificationToken);
            res.status(400).json({ message: "A new email has been sent to your email plz verify!!" })
        }


        if (user && await bcrypt.compare(password, user.password)) {
            const accessToken = jwt.sign({
                id: user._id,
                email: user.email,
                role: user.role,
                isVerified: user.isVerified
            }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: "1h" });
            res.status(200).json({ token: accessToken, message: "User logged in", user: user });
        } else {
            res.status(401).json({ message: "Invalid credentials" })
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
        console.log(error);
    }
});


//send-reset-password-email
const sendResetPasswordEmail = async (req, res) => {


    try {
        let user = await User.findOne({ email: req.body.email });

        if (!user) {
            return res.status(404).json({ mssg: 'Email does not exist' });
        } else {
            //logic to delete exisitng otp
            const otpexist = OTP.findOne({ email: req.body.email })
            if (otpexist) {
                await OTP.deleteMany({ email: req.body.email });
            }

            const expirationDate = new Date(Date.now() + 10 * 60 * 1000);
            const otpcode = generateOTP();
            const otpData = new OTP({
                code: otpcode,
                email: req.body.email,
                expiration: expirationDate,
            });

            await otpData.save();
            await resetPasswordEmail(req.body.email, otpcode);

            res.status(200).json({ mssg: 'OTP sent successfully', otp: otpData });
        }
    } catch (error) {
        res.status(500).json({ mssg: 'Error' });
        console.log(error);
    }
};


const resetPassword = async (req, res) => {
    const { email, otpCode, password } = req.body;
    try {
        console.log(email, otpCode, password);
        let data = await OTP.findOne({ email, code: otpCode });
        console.log(data);


        if (!data) {
            return res.status(404).json({ mssg: 'Invalid OTP' });
        } else {
            let currentTime = new Date();
            if (currentTime > data.expiration) {
                res.status(401).json({ mssg: "Token Expired" });
            } else {
                let user = await User.findOne({ email });


                if (!user) {
                    res.status(404).json({ mssg: "User does not exist" });
                } else {
                    const hashedPassword = await bcrypt.hash(password, 10);
                    user.password = hashedPassword;
                    await user.save();
                    res.status(200).json({ mssg: "Password changed successfully" });
                }
            }
        }
    } catch (error) {
        res.status(500).json({ mssg: 'Error' });
        console.log(error);
    }
}


const getUserById = async (req, res) => {
    const { userId } = req.params;
    try {
        const user = await User.findById(userId);
        if (!user) {
            res.status(404).json({ mssg: "User not found" });
        }

        res.status(200).json({ mssg: "User found", user: user });

    } catch (error) {
        res.status(501).json({ mssg: error })
    }
}

//gettotalLikes by userId

const getTotalLikes = async (userId) => {
    const notes = await Note.find({ author: userId });
    let totalLikes = 0;

    notes.forEach(note => {
        totalLikes += note.likes.length;
    })
    return totalLikes;
}


const getUserInfo = async (req, res) => {
    const { userId } = req.params;
    try {


        const existingUser = await User.findById(userId);
        if (!existingUser) {
            res.status(401).json({ message: "user not found" })
        }



        const totalLikesOfUser = await getTotalLikes(userId);

        const userDetails = {
            coins: existingUser.coins,
            notesUploaded: existingUser.notesUploaded?.length || 0,
            notesBought: existingUser.notesBought?.length || 0,
            totalLikes: totalLikesOfUser || 0

        }

        res.status(200).json({ userDetails: userDetails })

    } catch (error) {
        console.log(error)
        res.status(500).json({ error: error })
    }
}


const getUsersLeaderBoard = async (req, res) => {
    try {
        const users = await User.find().sort({ coins: -1 });
        if (!users) {
            return res.status(401).json({ message: "No users found" });
        }

        const usersLeaderBoard = users.map((user, index) => {
            return {
                rank: index + 1,
                username: user.username,
                coins: user.coins
            };
        });

        res.json(usersLeaderBoard);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Internal Server Error" });
    }
};

module.exports = {
    userInfo,
    registerUser,
    loginUser,
    verifyemail,
    sendResetPasswordEmail,
    resetPassword,
    getUserInfo,
    getUserById,
    getUsersLeaderBoard

} 