const crypto = require("crypto")

const jwt = require('jsonwebtoken')
const bcrypt = require('bcryptjs')

const asyncHandler = require('express-async-handler')
const ApiError = require('../utils/apiError')
const User = require('../models/UserModel')
const sendEmail = require("../utils/sendEmail")


const createToken = (payload) =>
    jwt.sign({ userId: payload }, process.env.JWT_SECRET_KEY, {
        expiresIn: process.env.JWT_EXPIRE_TIME,
    })



// @desc       Signup
// @route      PUT   /api/v1/auth/signup
// @access     public
exports.signup = asyncHandler(async (req, res, next) => {
    // 1) create user
    const user = await User.create({
        name: req.body.name,
        email: req.body.email,
        password: req.body.password,
    })

    // 2) generate token
    const token = createToken(user._id)

    res.status(201).json({ data: user, token })
})

exports.login = asyncHandler(async (req, res, next) => {
    // 1) check if password and email in the body
    const user = await User.findOne({ email: req.body.email })

    // 2) check if user exist and check if password is correct
    if (!user || !(await bcrypt.compare(req.body.password, user.password))) {
        return next(new ApiError("Incorrect email or password", 401))
    }
    // 3) generate token
    const token = createToken(user._id)
    // 4) send response to client side
    res.status(200).json({ data: user, token })
})

exports.protect = asyncHandler(async (req, res, next) => {
    // 1) check if token exist, if so get it
    let token

    if (req.headers.authorization && req.headers.authorization.startsWith("Bearer")) {
        token = req.headers.authorization.split(" ")[1]
    }
    if (!token) {
        return next(new ApiError("You are not login, please login to get access this route"), 401)
    }

    // 2) verify token (no change happens, or the token has been expired)
    const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY)
    // decode : {
    // userId : 334345435342324,
    // iat : 154354354
    // exp : 154359643
    // }

    // 3) ckdck if user exists
    const currentUser = await User.findById(decoded.userId)
    if (!currentUser) {
        return next(new ApiError("the user that belong to this token no longer exist", 401))
    }

    // 4) check if user change his password after token created
    if (currentUser.passwordChangedAt) {
        const passChangedTimestamp = parseInt(
            currentUser.passwordChangedAt.getTime() / 1000, 10
        )
        // password changed after token created (error)
        if (passChangedTimestamp < decoded.iat) {
            return next(new ApiError("user recently changed his password, please login again..", 401))
        }
    }
    req.user = currentUser
    next()
})

// @desc       Authorization (user permession)
// only for ["admin", 'manger']

exports.allowedTo = (...roles) => asyncHandler(async (req, res, next) => {
    // 1) access roles
    // 2) access registered user (req.user.role)
    if (!roles.includes(req.user.role)) {
        return next(new ApiError("You are not allowed to acces this route", 403))
    }

    next()

})


// @desc       Forget Password
// @route      Post   /api/v1/auth/forgotPassword
// @access     public
exports.forgotPassword = asyncHandler(async (req, res, next) => {
    // 1) Get user by email
    const user = await User.findOne({ email: req.body.email });
    if (!user) {
        return next(
            new ApiError(`There is no user with that email ${req.body.email}`, 404)
        );
    }
    // 2) If user exist, Generate hash reset random 6 digits and save it in db
    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
    const hashedResetCode = crypto
        .createHash('sha256')
        .update(resetCode)
        .digest('hex');

    // Save hashed password reset code into db
    user.passwordResetCode = hashedResetCode;
    // Add expiration time for password reset code (10 min)
    user.passwordResetExpires = Date.now() + 10 * 60 * 1000;
    user.passwordResetVerified = false;

    await user.save();

    // 3) Send the reset code via email
    const message = `Hi ${user.name},\n We received a request to reset the password on your E-shop Account. \n ${resetCode} \n Enter this code to complete the reset. \n Thanks for helping us keep your account secure.\n The E-shop Team`;
    try {
        await sendEmail({
            email: user.email,
            subject: 'Your password reset code (valid for 10 min)',
            message,
        });
    } catch (err) {
        user.passwordResetCode = undefined;
        user.passwordResetExpires = undefined;
        user.passwordResetVerified = undefined;

        await user.save();
        return next(new ApiError('There is an error in sending email', 500));
    }

    res
        .status(200)
        .json({ status: 'Success', message: 'Reset code sent to email' });
});


// @desc       Verify Reset Code Password
// @route      Post   /api/v1/auth/verifyResetCode
// @access     public
exports.passwordResetVerified = asyncHandler(async (req, res, next) => {
    // 1) get the user based on reset code 
    const hashedResetCode = crypto
        .createHash('sha256')
        .update(req.body.resetCode)
        .digest('hex');

    const user = await User.findOne({
        passwordResetCode: hashedResetCode,
        passwordResetExpires: { $gt: Date.now() },
    })
    if (!user) return next(new ApiError('Reset code invalid or expired'))

    // 2) Reset code valid
    user.passwordResetVerified = true
    await user.save()

    res.status(200).json({
        status: 'Success'
    })
})